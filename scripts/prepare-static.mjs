import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';

const output = path.resolve(process.env.SUITE_DESK_OUTPUT || 'dist');
const manifestPath = path.resolve(process.env.SUITE_DESK_MANIFEST || 'installers/manifest.json');
const sitePath = path.resolve(process.env.SUITE_DESK_SITE || 'index.html');
const vercelPath = path.resolve(process.env.SUITE_DESK_VERCEL_CONFIG || 'vercel.json');
const allowFetch = process.env.SUITE_DESK_ALLOW_FETCH === '1';
const baseUrl = process.env.SUITE_DESK_BASE_URL || '';
const timeoutMs = Number(process.env.SUITE_DESK_FETCH_TIMEOUT_MS || 120000);

function fail(code, message) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function assertLocalBase(value) {
  if (!value) return;
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(1, 'SUITE_DESK_BASE_URL is not a URL');
  }
  if (url.username || url.password) fail(1, 'SUITE_DESK_BASE_URL must not include credentials');
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    fail(1, 'SUITE_DESK_BASE_URL must be http or https');
  }
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
    fail(1, 'SUITE_DESK_BASE_URL host must be 127.0.0.1 or localhost');
  }
}

function resolveAssetUrl(assetUrl) {
  const url = new URL(assetUrl);
  if (!baseUrl) {
    if (url.protocol !== 'https:') fail(1, `asset URL must be https: ${assetUrl}`);
    return assetUrl;
  }
  const root = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL(`${url.pathname.replace(/^\//, '')}${url.search}`, root).toString();
}

async function fileDigest(file) {
  const hash = createHash('sha256');
  let bytes = 0;
  const stream = createReadStream(file);
  try {
    for await (const chunk of stream) {
      bytes += chunk.length;
      hash.update(chunk);
    }
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  return { bytes, sha256: hash.digest('hex') };
}

async function matches(file, asset) {
  const digest = await fileDigest(file);
  return digest !== null && digest.bytes === asset.bytes && digest.sha256 === asset.sha256;
}

async function download(url, dest, asset) {
  const tmp = `${dest}.partial`;
  await rm(tmp, { force: true });
  process.stderr.write(`fetch ${url}\n`);
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'user-agent': 'suite-desk-install-prepare',
      'accept-encoding': 'identity',
    },
  });
  if (!response.ok) fail(1, `download failed ${response.status} for ${asset.name}`);
  const declared = response.headers.get('content-length');
  if (declared !== null && Number(declared) > asset.bytes) {
    await response.body?.cancel();
    fail(1, `download exceeds pinned ${asset.bytes} bytes for ${asset.name}`);
  }

  await mkdir(path.dirname(dest), { recursive: true });
  const stream = createWriteStream(tmp, { flags: 'wx' });
  const hash = createHash('sha256');
  let received = 0;
  let tooBig = false;
  try {
    for await (const chunk of response.body) {
      const buf = Buffer.from(chunk);
      received += buf.length;
      if (received > asset.bytes) {
        tooBig = true;
        break;
      }
      hash.update(buf);
      if (!stream.write(buf)) await once(stream, 'drain');
    }
  } catch (error) {
    stream.destroy();
    await once(stream, 'close').catch(() => {});
    await rm(tmp, { force: true });
    throw error;
  }

  if (tooBig) {
    await response.body?.cancel().catch(() => {});
    stream.destroy();
    await once(stream, 'close').catch(() => {});
    await rm(tmp, { force: true });
    fail(1, `download exceeds pinned ${asset.bytes} bytes for ${asset.name}`);
  }

  stream.end();
  await once(stream, 'finish');
  const sum = hash.digest('hex');
  if (received !== asset.bytes || sum !== asset.sha256) {
    await rm(tmp, { force: true });
    fail(1, `checksum mismatch for ${asset.name}: got ${received} bytes ${sum}`);
  }
  await rename(tmp, dest);
}

function validateAsset(asset) {
  if (!asset || typeof asset.name !== 'string' || !/^[A-Za-z0-9._-]+$/.test(asset.name)) {
    fail(1, 'asset name is unsafe');
  }
  if (asset.path !== `/downloads/${asset.name}`) fail(1, `path/name mismatch for ${asset.name}`);
  if (!/^https:\/\//.test(asset.url)) fail(1, `asset URL must be https: ${asset.name}`);
  if (!/^[0-9a-f]{64}$/.test(asset.sha256)) fail(1, `sha256 invalid for ${asset.name}`);
  if (!Number.isInteger(asset.bytes) || asset.bytes < 0) fail(1, `bytes invalid for ${asset.name}`);
}

async function main() {
  assertLocalBase(baseUrl);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (!Array.isArray(manifest.assets) || manifest.assets.length === 0) fail(1, 'manifest assets missing');
  const seen = new Set();
  for (const asset of manifest.assets) {
    validateAsset(asset);
    if (seen.has(asset.path)) fail(1, `duplicate path ${asset.path}`);
    seen.add(asset.path);
  }

  const missing = [];
  for (const asset of manifest.assets) {
    const dest = path.join(output, 'downloads', asset.name);
    if (!(await matches(dest, asset))) missing.push(asset);
  }
  if (missing.length > 0 && !allowFetch) {
    fail(2, `SUITE_DESK_ALLOW_FETCH=1 is required to download ${missing.map((asset) => asset.name).join(', ')}`);
  }

  await rm(path.join(output, '.ready'), { force: true });
  await mkdir(path.join(output, 'downloads'), { recursive: true });
  await copyFile(sitePath, path.join(output, 'index.html'));
  const vercel = JSON.parse(await readFile(vercelPath, 'utf8'));
  const staticConfig = {
    framework: null,
    headers: vercel.headers,
  };
  if (vercel.$schema) staticConfig.$schema = vercel.$schema;
  await writeFile(path.join(output, 'vercel.json'), `${JSON.stringify(staticConfig, null, 2)}\n`);

  for (const asset of manifest.assets) {
    const dest = path.join(output, 'downloads', asset.name);
    if (!(await matches(dest, asset))) await download(resolveAssetUrl(asset.url), dest, asset);
    const confirmed = await fileDigest(dest);
    if (!confirmed || confirmed.bytes !== asset.bytes || confirmed.sha256 !== asset.sha256) {
      fail(1, `checksum mismatch for ${asset.name}`);
    }
    process.stdout.write(`ok ${asset.path} ${asset.sha256} ${asset.bytes}\n`);
  }

  const ready = {
    assets: manifest.assets.map((asset) => ({
      name: asset.name,
      path: asset.path,
      bytes: asset.bytes,
      sha256: asset.sha256,
    })),
  };
  await writeFile(path.join(output, '.ready'), `${JSON.stringify(ready, null, 2)}\n`);
}

await main();

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, stat, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

const LINUX = {
  tag: 'v1.3.1',
  name: 'suite-desk_1.3.0_amd64.deb',
  bytes: 77408588,
  sha256: '196bfe94270b7eb390ce4f92eab77e003c84c7e95e2496588ae2616609097916',
  url: 'https://github.com/MajorTurkey/suite-desk-download/releases/download/v1.3.1/suite-desk_1.3.0_amd64.deb',
  path: '/downloads/suite-desk_1.3.0_amd64.deb',
  contentType: 'application/vnd.debian.binary-package',
};
const WINDOWS = {
  tag: 'v1.2.0',
  name: 'Suite-Desk.exe',
  bytes: 127400666,
  sha256: '332afd72903270f2cf34f7119cc55fa1c6285710a6e6d04fc0a164a4463fe831',
  url: 'https://github.com/MajorTurkey/suite-desk-download/releases/download/v1.2.0/Suite-Desk.exe',
  path: '/downloads/Suite-Desk.exe',
  contentType: 'application/vnd.microsoft.portable-executable',
};
const PRESERVED = [
  {
    tag: 'v1.0.0',
    name: 'Suite-Desk.exe',
    bytes: 74246384,
    sha256: 'f7d78d1c4898d8c51e055c4de265c99e9a55d6ade5bedab6220ec21e6c590948',
  },
  {
    tag: 'v1.1.0',
    name: 'Suite-Desk-Windows.zip',
    bytes: 127381202,
    sha256: '4333b08bc61f349280a5f5cf43664948536d056f2c43338edd28894644f97639',
  },
  {
    tag: 'v1.3.0',
    name: 'Suite-Desk-Linux.tar.gz',
    bytes: 105926096,
    sha256: '563ba13815795bc4ced12b89d2d764c2d58c953906a38f2980fd9255411162ba',
  },
  {
    tag: 'v1.3.1',
    name: 'suite-desk-icon.png',
    bytes: 260714,
    sha256: '261669be9bfd199570be4b40e935107d00cb2c2a9930ec9a2d9df5d432a95b1c',
  },
];

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function landingFromLive(live) {
  let next = live;
  assert.equal(next.includes(LINUX.url), true);
  assert.equal(next.includes(WINDOWS.url), true);
  next = next.replaceAll(LINUX.url, LINUX.path).replaceAll(WINDOWS.url, WINDOWS.path);
  assert.equal(next.includes('github.com'), false);
  assert.equal(next.includes(LINUX.path), true);
  assert.equal(next.includes(WINDOWS.path), true);
  return next;
}

function sourceMatches(source, pathname) {
  return new RegExp(`^${source}$`).test(pathname);
}

async function listen(handler) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  return {
    server,
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function runPrepare(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(root, 'scripts/prepare-static.mjs')], {
      cwd: root,
      env: { ...process.env, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

test('public landing baseline is the fetched production HTML', async () => {
  const meta = JSON.parse(await readFile(path.join(root, 'baseline/live-response.json'), 'utf8'));
  const live = await readFile(path.join(root, 'baseline/live-index.html'));
  const repo = await readFile(path.join(root, 'baseline/repo-index.html'));
  assert.equal(live.length, meta.contentLength);
  assert.equal(sha256(live), meta.sha256);
  assert.equal(repo.length, meta.repoIndexBytes);
  assert.equal(sha256(repo), meta.repoIndexSha256);
  assert.match(repo.toString('utf8'), /v1\.0\.0\/Suite-Desk\.exe/);
  assert.match(repo.toString('utf8'), /Jack's Desk/);
  assert.match(live.toString('utf8'), /Download for Linux/);
  assert.equal(live.equals(repo), false);
});

test('served landing keeps the live page and uses same-origin installer paths', async () => {
  const live = await readFile(path.join(root, 'baseline/live-index.html'), 'utf8');
  const page = await readFile(path.join(root, 'index.html'), 'utf8');
  assert.equal(page, landingFromLive(live));
  assert.equal(/<script/i.test(page), false);
  assert.equal(/apex/i.test(page), false);
  assert.equal(/analytics|vercel-scripts|googletagmanager/i.test(page), false);
});

test('manifest pins the current installers and leaves original releases untouched', async () => {
  const manifest = JSON.parse(await readFile(path.join(root, 'installers/manifest.json'), 'utf8'));
  assert.deepEqual(manifest.assets.map(({ tag, name, bytes, sha256: sum, url, path: assetPath, contentType }) => ({
    tag, name, bytes, sha256: sum, url, path: assetPath, contentType,
  })), [LINUX, WINDOWS]);
  assert.equal(manifest.assets.reduce((sum, asset) => sum + asset.bytes, 0), 204809254);
  const preserved = manifest.preservedGithubReleases.map(({ tag, name, bytes, sha256: sum }) => ({
    tag, name, bytes, sha256: sum,
  }));
  assert.deepEqual(preserved, PRESERVED);
  const current = new Set(manifest.assets.map((asset) => asset.url));
  for (const item of manifest.preservedGithubReleases) {
    assert.equal(current.has(item.url), false);
    assert.equal(item.url.startsWith('https://github.com/MajorTurkey/suite-desk-download/releases/download/'), true);
  }
  const page = await readFile(path.join(root, 'index.html'), 'utf8');
  for (const asset of manifest.assets) {
    assert.equal(page.includes(`href="${asset.path}"`), true);
  }
});

test('vercel config is a static preview build with per-file download headers', async () => {
  const config = JSON.parse(await readFile(path.join(root, 'vercel.json'), 'utf8'));
  assert.equal(config.framework, null);
  assert.equal(config.outputDirectory, 'dist');
  assert.match(config.buildCommand, /node scripts\/prepare-static\.mjs/);
  assert.equal(config.buildCommand.includes('SUITE_DESK_ALLOW_FETCH'), false);
  assert.equal(config.rewrites, undefined);
  assert.equal(config.redirects, undefined);
  assert.equal(config.crons, undefined);
  const spoofDeb = LINUX.path.replaceAll('.', 'X');
  const deb = config.headers.find((rule) => sourceMatches(rule.source, LINUX.path) && !sourceMatches(rule.source, WINDOWS.path));
  const exe = config.headers.find((rule) => sourceMatches(rule.source, WINDOWS.path) && !sourceMatches(rule.source, LINUX.path));
  assert.ok(deb);
  assert.ok(exe);
  assert.equal(sourceMatches(deb.source, spoofDeb), false);
  assert.equal(sourceMatches(exe.source, WINDOWS.path.replaceAll('.', 'X')), false);
  assert.deepEqual(deb.headers, [
    { key: 'Content-Type', value: LINUX.contentType },
    { key: 'Content-Disposition', value: `attachment; filename="${LINUX.name}"` },
  ]);
  assert.deepEqual(exe.headers, [
    { key: 'Content-Type', value: WINDOWS.contentType },
    { key: 'Content-Disposition', value: `attachment; filename="${WINDOWS.name}"` },
  ]);
});

test('large binaries, vercel link metadata, and secrets stay out of git', async () => {
  for (const ignored of ['dist/downloads/Suite-Desk.exe', 'dist/downloads/suite-desk_1.3.0_amd64.deb', '.vercel/project.json']) {
    const result = spawnSync('git', ['check-ignore', '-q', ignored], { cwd: root });
    assert.equal(result.status, 0, `${ignored} should be ignored`);
  }
  const names = await readdir(root, { recursive: true });
  for (const name of names) {
    if (name === '.git' || name.startsWith(`.git${path.sep}`)) continue;
    const full = path.join(root, name);
    const info = await stat(full);
    if (!info.isFile()) continue;
    const ignored = spawnSync('git', ['check-ignore', '-q', name], { cwd: root });
    if (ignored.status === 0) continue;
    assert.ok(info.size < 1_000_000, `${name} is ${info.size} bytes`);
    if (!/\.(html|json|mjs|md|sh|txt)$/.test(name) && name !== '.gitignore' && name !== '.vercelignore') continue;
    const text = await readFile(full, 'utf8');
    const secret = /(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|VERCEL_TOKEN\s*=\s*\S+/;
    assert.equal(secret.test(text), false, name);
  }
});

test('deploy command names this project only and does not run vercel', () => {
  const marker = path.join(tmpdir(), `suite-desk-vercel-called-${process.pid}`);
  if (existsSync(marker)) spawnSync('rm', ['-f', marker]);
  const bin = spawnSync('mktemp', ['-d'], { encoding: 'utf8' }).stdout.trim();
  const fake = path.join(bin, 'vercel');
  spawnSync('sh', ['-c', `printf '%s\\n' '#!/bin/sh' 'touch ${marker}' 'exit 99' > '${fake}' && chmod +x '${fake}'`]);
  const result = spawnSync('sh', [path.join(root, 'scripts/print-deploy-command.sh')], {
    cwd: root,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(marker), false);
  assert.match(result.stdout, /prj_It6b1DpRq1ZTeKyfyeWeCKjyfyta/);
  assert.match(result.stdout, /team_3hvTm6PvjglsYDXjJqHy6GCK/);
  assert.match(result.stdout, /--project suite-desk-install/);
  assert.match(result.stdout, /--scope team_3hvTm6PvjglsYDXjJqHy6GCK/);
  assert.match(result.stdout, /--target preview/);
  assert.match(result.stdout, /--archive=tgz/);
  assert.match(result.stdout, /SUITE_DESK_ALLOW_FETCH=1 node scripts\/prepare-static\.mjs/);
  assert.match(result.stdout, /204809254/);
  assert.match(result.stdout, /127400666/);
  assert.match(result.stdout, /100 MB/);
  assert.match(result.stdout, /1 GB/);
  assert.match(result.stdout, /403/);
  assert.match(result.stdout, /Enterprise is published as N\/A/);
  assert.doesNotMatch(result.stdout, /--prod\b/);
  assert.match(result.stdout, /Do not add SUITE_DESK_ALLOW_FETCH to the Vercel project/);
  assert.match(result.stdout, /Blob/);
});

test('prepare downloads checksum-pinned same-origin files and stops on a bad file', async (t) => {
  const debBody = Buffer.from('linux-installer-bytes');
  const exeBody = Buffer.from('windows-installer-bytes');
  const badBody = Buffer.from('not-the-installer');
  const hits = [];
  let mockBase = '';
  const mock = await listen((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    hits.push({ method: req.method, pathname: url.pathname });
    if (req.method !== 'GET') {
      res.writeHead(405);
      res.end();
      return;
    }
    if (url.pathname === '/files/Suite-Desk.exe') {
      res.writeHead(200, { 'Content-Length': String(exeBody.length) });
      res.end(exeBody);
      return;
    }
    if (url.pathname.endsWith('/suite-desk_1.3.0_amd64.deb')) {
      res.writeHead(200);
      res.end(debBody);
      return;
    }
    if (url.pathname.endsWith('/Suite-Desk.exe')) {
      res.writeHead(302, { Location: `${mockBase}/files/Suite-Desk.exe` });
      res.end();
      return;
    }
    if (url.pathname.endsWith('/bad.exe')) {
      res.writeHead(200);
      res.end(badBody);
      return;
    }
    if (url.pathname.endsWith('/huge.deb')) {
      res.writeHead(200);
      res.end(Buffer.alloc(64, 1));
      return;
    }
    res.writeHead(404);
    res.end('missing');
  });
  mockBase = mock.base;
  t.after(() => mock.close());

  const work = await mkdtemp(path.join(tmpdir(), 'suite-desk-prepare-'));
  t.after(() => rm(work, { recursive: true, force: true }));
  const manifestPath = path.join(work, 'manifest.json');
  const sitePath = path.join(work, 'index.html');
  const output = path.join(work, 'dist');
  const site = `<p><a href="${LINUX.path}">Linux</a> <a href="${WINDOWS.path}">Windows</a></p>\n`;
  await writeFile(sitePath, site);
  const manifest = {
    assets: [
      {
        ...LINUX,
        bytes: debBody.length,
        sha256: sha256(debBody),
        url: LINUX.url,
      },
      {
        ...WINDOWS,
        bytes: exeBody.length,
        sha256: sha256(exeBody),
        url: WINDOWS.url,
      },
    ],
  };
  await writeFile(manifestPath, JSON.stringify(manifest));

  const blocked = await runPrepare({
    SUITE_DESK_OUTPUT: output,
    SUITE_DESK_MANIFEST: manifestPath,
    SUITE_DESK_SITE: sitePath,
    SUITE_DESK_BASE_URL: mock.base,
  });
  assert.equal(blocked.status, 2, blocked.stderr);
  assert.equal(hits.length, 0);
  assert.equal(existsSync(output), false);

  const remote = await runPrepare({
    SUITE_DESK_ALLOW_FETCH: '1',
    SUITE_DESK_OUTPUT: output,
    SUITE_DESK_MANIFEST: manifestPath,
    SUITE_DESK_SITE: sitePath,
    SUITE_DESK_BASE_URL: 'http://example.com',
  });
  assert.notEqual(remote.status, 0);
  assert.match(remote.stderr, /127\.0\.0\.1|localhost/);
  assert.equal(hits.length, 0);

  const ready = await runPrepare({
    SUITE_DESK_ALLOW_FETCH: '1',
    SUITE_DESK_OUTPUT: output,
    SUITE_DESK_MANIFEST: manifestPath,
    SUITE_DESK_SITE: sitePath,
    SUITE_DESK_BASE_URL: mock.base,
  });
  assert.equal(ready.status, 0, ready.stderr);
  const deb = await readFile(path.join(output, 'downloads', LINUX.name));
  const exe = await readFile(path.join(output, 'downloads', WINDOWS.name));
  assert.equal(sha256(deb), sha256(debBody));
  assert.equal(sha256(exe), sha256(exeBody));
  assert.equal(await readFile(path.join(output, 'index.html'), 'utf8'), site);
  const readyFile = JSON.parse(await readFile(path.join(output, '.ready'), 'utf8'));
  assert.equal(readyFile.assets[0].sha256, sha256(debBody));
  assert.equal(readyFile.assets[1].sha256, sha256(exeBody));
  const staticConfig = JSON.parse(await readFile(path.join(output, 'vercel.json'), 'utf8'));
  assert.equal(staticConfig.buildCommand, undefined);
  assert.deepEqual(staticConfig.headers, JSON.parse(await readFile(path.join(root, 'vercel.json'), 'utf8')).headers);
  const methods = new Set(hits.map((hit) => hit.method));
  assert.deepEqual([...methods], ['GET']);
  const before = hits.length;

  const again = await runPrepare({
    SUITE_DESK_OUTPUT: output,
    SUITE_DESK_MANIFEST: manifestPath,
    SUITE_DESK_SITE: sitePath,
  });
  assert.equal(again.status, 0, again.stderr);
  assert.equal(hits.length, before);

  const badManifest = {
    assets: [{
      ...WINDOWS,
      name: 'bad.exe',
      bytes: badBody.length + 1,
      sha256: sha256(badBody),
      url: 'https://github.com/MajorTurkey/suite-desk-download/releases/download/v1.2.0/bad.exe',
      path: '/downloads/bad.exe',
    }],
  };
  const badManifestPath = path.join(work, 'bad.json');
  const badOutput = path.join(work, 'bad-dist');
  await writeFile(badManifestPath, JSON.stringify(badManifest));
  const mismatch = await runPrepare({
    SUITE_DESK_ALLOW_FETCH: '1',
    SUITE_DESK_OUTPUT: badOutput,
    SUITE_DESK_MANIFEST: badManifestPath,
    SUITE_DESK_SITE: sitePath,
    SUITE_DESK_BASE_URL: mock.base,
  });
  assert.equal(mismatch.status, 1, mismatch.stderr);
  assert.match(mismatch.stderr, /checksum mismatch/);
  assert.equal(existsSync(path.join(badOutput, 'downloads', 'bad.exe')), false);
  assert.equal(existsSync(path.join(badOutput, 'downloads', 'bad.exe.partial')), false);
  assert.equal(existsSync(path.join(badOutput, '.ready')), false);

  const hugeManifest = {
    assets: [{
      ...LINUX,
      name: 'huge.deb',
      bytes: 8,
      sha256: sha256(Buffer.alloc(8, 1)),
      url: 'https://github.com/MajorTurkey/suite-desk-download/releases/download/v1.3.1/huge.deb',
      path: '/downloads/huge.deb',
    }],
  };
  const hugeManifestPath = path.join(work, 'huge.json');
  const hugeOutput = path.join(work, 'huge-dist');
  await writeFile(hugeManifestPath, JSON.stringify(hugeManifest));
  const huge = await runPrepare({
    SUITE_DESK_ALLOW_FETCH: '1',
    SUITE_DESK_OUTPUT: hugeOutput,
    SUITE_DESK_MANIFEST: hugeManifestPath,
    SUITE_DESK_SITE: sitePath,
    SUITE_DESK_BASE_URL: mock.base,
  });
  assert.equal(huge.status, 1, huge.stderr);
  assert.match(huge.stderr, /exceeds/);
  assert.equal(existsSync(path.join(hugeOutput, '.ready')), false);
  const downloads = existsSync(path.join(hugeOutput, 'downloads'))
    ? await readdir(path.join(hugeOutput, 'downloads'))
    : [];
  assert.deepEqual(downloads, []);

  const goodExe = path.join(output, 'downloads', WINDOWS.name);
  const preserved = await readFile(goodExe);
  const plantedManifest = {
    assets: [{
      ...WINDOWS,
      bytes: exeBody.length,
      sha256: sha256(Buffer.from('different-bytes')),
      url: WINDOWS.url,
    }],
  };
  const plantedPath = path.join(work, 'planted.json');
  await writeFile(plantedPath, JSON.stringify(plantedManifest));
  const keep = await runPrepare({
    SUITE_DESK_ALLOW_FETCH: '1',
    SUITE_DESK_OUTPUT: output,
    SUITE_DESK_MANIFEST: plantedPath,
    SUITE_DESK_SITE: sitePath,
    SUITE_DESK_BASE_URL: mock.base,
  });
  assert.equal(keep.status, 1);
  assert.equal(Buffer.compare(await readFile(goodExe), preserved), 0);
  assert.equal(existsSync(path.join(output, '.ready')), false);

  const siteServer = await listen((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.join(output, rel);
    readFile(file).then((body) => {
      res.writeHead(200);
      res.end(body);
    }).catch(() => {
      res.writeHead(404);
      res.end('missing');
    });
  });
  t.after(() => siteServer.close());
  const page = await fetch(`${siteServer.base}/`);
  const html = await page.text();
  assert.equal(html.includes(`href="${LINUX.path}"`), true);
  assert.equal(html.includes(`href="${WINDOWS.path}"`), true);
  const downloaded = await fetch(`${siteServer.base}${LINUX.path}`);
  assert.equal(Buffer.compare(Buffer.from(await downloaded.arrayBuffer()), debBody), 0);
  const windows = await fetch(`${siteServer.base}${WINDOWS.path}`);
  assert.equal(windows.status, 200);
  assert.equal(Buffer.compare(Buffer.from(await windows.arrayBuffer()), exeBody), 0);
});

test('vercelignore keeps baselines and prepared binaries out of a source upload', async () => {
  const text = await readFile(path.join(root, '.vercelignore'), 'utf8');
  for (const line of ['dist', 'baseline', 'test', '.vercel']) {
    assert.match(text, new RegExp(`(^|\\n)${line}(\\n|$)`));
  }
});

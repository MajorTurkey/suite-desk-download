# Suite Desk install

Static landing and same-origin downloads for the existing Suite Desk installers. This is not Apex, and it does not change Suite Clara web or Field.

The page served at https://suite-desk-install.vercel.app on 2026-11-06 is the baseline in `baseline/live-index.html`. `index.html` is that page with the two installer links changed to `/downloads/suite-desk_1.3.0_amd64.deb` and `/downloads/Suite-Desk.exe`. The previous committed page linked to the v1.0.0 Windows file and is kept at `baseline/repo-index.html`. It is not the live landing.

GitHub releases are the installer source and were not modified:

| Use | Tag | File | Bytes | SHA-256 |
| --- | --- | --- | --- | --- |
| Current Linux | v1.3.1 | suite-desk_1.3.0_amd64.deb | 77408588 | 196bfe94270b7eb390ce4f92eab77e003c84c7e95e2496588ae2616609097916 |
| Current Windows | v1.2.0 | Suite-Desk.exe | 127400666 | 332afd72903270f2cf34f7119cc55fa1c6285710a6e6d04fc0a164a4463fe831 |
| Backup | v1.0.0 | Suite-Desk.exe | 74246384 | f7d78d1c4898d8c51e055c4de265c99e9a55d6ade5bedab6220ec21e6c590948 |
| Backup | v1.1.0 | Suite-Desk-Windows.zip | 127381202 | 4333b08bc61f349280a5f5cf43664948536d056f2c43338edd28894644f97639 |
| Backup | v1.3.0 | Suite-Desk-Linux.tar.gz | 105926096 | 563ba13815795bc4ced12b89d2d764c2d58c953906a38f2980fd9255411162ba |
| Left on v1.3.1 | v1.3.1 | suite-desk-icon.png | 260714 | 261669be9bfd199570be4b40e935107d00cb2c2a9930ec9a2d9df5d432a95b1c |

The two current files total 204809254 bytes. They are not committed. `SUITE_DESK_ALLOW_FETCH=1 node scripts/prepare-static.mjs` downloads them into ignored `dist/downloads/` and checks the size and SHA-256 before writing `dist/.ready`.

## Deploy

Do not deploy until the Vercel plan for team `team_3hvTm6PvjglsYDXjJqHy6GCK` is confirmed. Published static file upload limits are Hobby 100 MB, Pro 1 GB, and Enterprise N/A. The Windows installer alone is over 100 MB. Project, deployment, and file reads returned 403 for scope majorturkey, so this repository does not record a verified plan. No upload was run.

Print the exact preview command:

```sh
sh scripts/print-deploy-command.sh
```

`vercel.json` tells a local `vercel build` to run the prepare script. The fetch gate is not set in that command, so a remote build stops instead of downloading the installers. Do not add `SUITE_DESK_ALLOW_FETCH` to the Vercel project.

#!/bin/sh
# Print the Suite Desk install preview command. This script does not run vercel.
set -eu
cat <<'EOF'
Suite Desk installer landing only. Do not target Apex, Suite Clara web, Field, or any other Vercel project. Do not change DNS. Do not provision Blob. Do not buy or upgrade a plan from this repository.

Plan entitlement was not verified. Project, deployment, and deployment-file reads for team_3hvTm6PvjglsYDXjJqHy6GCK returned 403 for scope majorturkey. get_team was not called. No re-authentication was attempted. Do not run the deploy until a person who can open this team confirms the static file upload limit. Published limits: Hobby 100 MB, Pro 1 GB, Enterprise is published as N/A.

Installer payload: suite-desk_1.3.0_amd64.deb 77408588 bytes plus Suite-Desk.exe 127400666 bytes = 204809254 bytes, plus the landing page. The Windows file alone is 127400666 bytes and is already over 100 MB.

Do not add SUITE_DESK_ALLOW_FETCH to the Vercel project environment. A remote build would download the installers on Vercel. Prepare them locally, then upload the dist directory only after the plan limit is confirmed. Set VERCEL_TOKEN in the operator shell. Do not commit it. Do not deploy to production. The command below is a preview target only.

Preparation, which does not upload. Deploy only after the prepare command exits 0 and dist/.ready exists:
  npm test
  SUITE_DESK_ALLOW_FETCH=1 node scripts/prepare-static.mjs

Preview upload of dist to the existing project. This uploads about 205 MB. Stop if the CLI asks to link a different project.

  VERCEL_ORG_ID=team_3hvTm6PvjglsYDXjJqHy6GCK VERCEL_PROJECT_ID=prj_It6b1DpRq1ZTeKyfyeWeCKjyfyta vercel deploy dist --archive=tgz --scope team_3hvTm6PvjglsYDXjJqHy6GCK --project suite-desk-install --target preview

Project: suite-desk-install
Project id: prj_It6b1DpRq1ZTeKyfyeWeCKjyfyta
Team id: team_3hvTm6PvjglsYDXjJqHy6GCK
Production alias, unchanged by this task: https://suite-desk-install.vercel.app
Claimed current deployment, not re-read from the API: dpl_DWYzy3VLYcmRRoBPJjpU7cdKGtyY
EOF

#!/usr/bin/env bash
# Build and upload the static site to the droplet (ssh host alias "jk").
# nginx serves /srv/druid-grove/current as druid-grove.brackcarmony.com.
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build
rsync -rlptz --delete --chmod=D755,F644 dist/ jk:/srv/druid-grove/current/
echo "Deployed to https://druid-grove.brackcarmony.com"

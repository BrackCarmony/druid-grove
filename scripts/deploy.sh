#!/usr/bin/env bash
# Build and upload the static site to the droplet (ssh host alias "jk").
# nginx serves /srv/druid-grove/current as druid-grove.brackcarmony.com.
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build
# (macOS ships openrsync, which has no --chmod, so permissions are fixed up after.)
rsync -rlptz --delete dist/ jk:/srv/druid-grove/current/
ssh jk 'cd /srv/druid-grove/current && find . -type d -exec chmod 755 {} + && find . -type f -exec chmod 644 {} +'
echo "Deployed to https://druid-grove.brackcarmony.com"

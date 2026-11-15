#!/usr/bin/env bash
# Install or update the cloud-save service on the droplet (idempotent): the Python server, its
# systemd unit, and the nginx endpoint. Saves live in /var/lib/druid-grove-cloud.
set -euo pipefail
cd "$(dirname "$0")/.."
HOST="${DEPLOY_HOST:-jk}"

ssh "$HOST" 'mkdir -p /srv/druid-grove/cloud'
scp -q deploy/cloud-server.py "$HOST":/srv/druid-grove/cloud/cloud-server.py
scp -q deploy/druid-grove-cloud.service "$HOST":/etc/systemd/system/druid-grove-cloud.service
scp -q deploy/nginx-cloud-http.conf "$HOST":/etc/nginx/conf.d/druid-grove-cloud.conf
scp -q deploy/nginx-cloud-location.conf "$HOST":/etc/nginx/snippets/druid-grove-cloud.conf
ssh "$HOST" bash -s <<'REMOTE'
set -euo pipefail
chmod 644 /srv/druid-grove/cloud/cloud-server.py
systemctl daemon-reload
systemctl enable --now druid-grove-cloud
systemctl restart druid-grove-cloud
site=/etc/nginx/sites-available/druid-grove
if ! grep -q 'snippets/druid-grove-cloud.conf' "$site"; then
  cp "$site" "$site.bak-cloud"
  sed -i 's|^  include /etc/nginx/snippets/druid-grove-perf.conf;|  include /etc/nginx/snippets/druid-grove-perf.conf;\n  include /etc/nginx/snippets/druid-grove-cloud.conf;|' "$site"
fi
nginx -t
systemctl reload nginx
sleep 1
systemctl is-active druid-grove-cloud
echo "cloud saves ready"
REMOTE

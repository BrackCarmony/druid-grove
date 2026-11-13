#!/usr/bin/env bash
# One-time (idempotent) server setup for the /api/perf telemetry endpoint on the droplet.
# Installs the nginx config from deploy/, hooks it into the site, and reloads nginx.
set -euo pipefail
cd "$(dirname "$0")/.."
HOST="${DEPLOY_HOST:-jk}"

scp -q deploy/nginx-perf-http.conf "$HOST":/etc/nginx/conf.d/druid-grove-perf.conf
scp -q deploy/nginx-perf-location.conf "$HOST":/etc/nginx/snippets/druid-grove-perf.conf
scp -q deploy/logrotate-perf "$HOST":/etc/logrotate.d/druid-grove
ssh "$HOST" bash -s <<'REMOTE'
set -euo pipefail
mkdir -p /var/log/druid-grove
site=/etc/nginx/sites-available/druid-grove
if ! grep -q 'snippets/druid-grove-perf.conf' "$site"; then
  cp "$site" "$site.bak"
  sed -i 's|^  index index.html;|  index index.html;\n\n  include /etc/nginx/snippets/druid-grove-perf.conf;|' "$site"
fi
nginx -t
systemctl reload nginx
echo "perf endpoint ready"
REMOTE

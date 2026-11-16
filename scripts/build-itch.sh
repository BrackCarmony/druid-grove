#!/usr/bin/env bash
# Build the itch.io upload: a zip with index.html at the top, all paths relative (itch serves
# HTML5 games from a subfolder of its own domain). Cloud save and perf reports are off in it.
#   npm run build:itch   ->   druid-grove-itch.zip
set -euo pipefail
cd "$(dirname "$0")/.."
npx tsc --noEmit
npx vite build --mode itch --base ./ --outDir dist-itch --emptyOutDir
rm -f druid-grove-itch.zip
(cd dist-itch && zip -qr ../druid-grove-itch.zip . -x '.DS_Store')
echo "Wrote druid-grove-itch.zip ($(du -h druid-grove-itch.zip | cut -f1))"

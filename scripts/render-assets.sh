#!/usr/bin/env bash
# Re-render README / social assets from their SVG sources. Needs Chrome (headless) and, for the GIF, vhs.
set -euo pipefail
cd "$(dirname "$0")/.."
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
[ -x "$CHROME" ] || CHROME="$(command -v google-chrome || command -v chromium || true)"
if [ -n "$CHROME" ]; then
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --window-size=1280,640 --screenshot="$PWD/assets/social-preview.png" "file://$PWD/assets/banner.svg" 2>/dev/null
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --window-size=980,560  --screenshot="$PWD/assets/demo-static.png"   "file://$PWD/assets/demo-static.svg" 2>/dev/null
  echo "rendered assets/social-preview.png (1280x640) and assets/demo-static.png"
else
  echo "no Chrome found — skipping PNG renders" >&2
fi
if command -v vhs >/dev/null; then
  node scripts/seed-demo.js demo-app >/dev/null
  vhs assets/demo.tape
  rm -rf demo-app
  echo "rendered assets/demo.gif and assets/demo.mp4"
else
  echo "vhs not installed (brew install vhs) — skipping GIF" >&2
fi

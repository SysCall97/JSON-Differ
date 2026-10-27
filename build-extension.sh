#!/usr/bin/env bash
# Packages extension/ into docs/rtdb-tree-editor.zip, which the site's
# "Download extension" button links to (served by GitHub Pages).
set -euo pipefail
cd "$(dirname "$0")/extension"
tmp="$(mktemp -d)/rtdb-tree-editor.zip"
zip -r -X "$tmp" . -x '.*' '*/.*' > /dev/null
cat "$tmp" > ../docs/rtdb-tree-editor.zip   # overwrite in place
echo "Built docs/rtdb-tree-editor.zip (version $(grep -o '"version": *"[^"]*"' manifest.json | cut -d'"' -f4))"

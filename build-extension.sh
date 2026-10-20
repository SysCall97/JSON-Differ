#!/usr/bin/env bash
# Packages extension/ into docs/rtdb-tree-editor.zip, which the site's
# "Download extension" button links to (served by GitHub Pages).
set -euo pipefail
cd "$(dirname "$0")/extension"
rm -f ../docs/rtdb-tree-editor.zip
zip -r -X ../docs/rtdb-tree-editor.zip . -x '.*' '*/.*' > /dev/null
echo "Built docs/rtdb-tree-editor.zip (version $(grep -o '"version": *"[^"]*"' manifest.json | cut -d'"' -f4))"

#!/usr/bin/env bash
# Assembles index.html from the prototype sources + our own parts.
# Data and CSS tokens are pulled VERBATIM out of ../../prototypes so this view
# can never drift from the horizontal original.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
P="$HERE/../../prototypes"
OUT="$HERE/index.html"

{
  echo '<meta charset="utf-8">'
  echo '<title>Timeline — vertical</title>'
  # --- CSS tokens, verbatim from partA.html (lines 3-115 = the whole <style> block) ---
  sed -n '3,115p' "$P/partA.html"
  cat "$HERE/parts/00-style-add.html"
  cat "$HERE/parts/10-body.html"
  echo '<script>'
  echo '// ===== DATA — extracted verbatim, do not hand-edit. Re-run build.sh to refresh. ====='
  # EVENTS + its header comments, verbatim from partA.html
  sed -n '287,499p' "$P/partA.html"
  # LIVES, CATMAP, PLACEMAP, verbatim from datasets.js
  sed -n '1p;2p;6p' "$P/datasets.js"
  echo '</script>'
  echo '<script>'
  cat "$HERE/parts/30-vertical.js"
  echo '</script>'
} > "$OUT"

echo "built $OUT ($(wc -c < "$OUT") bytes)"

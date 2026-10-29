#!/usr/bin/env bash
# Squeezes the README's images (docs/readme/): desktop PNGs scaled to
# 1800 px wide (2x of the 900 px the README shows), every PNG through
# pngquant then oxipng, and the mascots clip (mascots-clip.webm, recorded by
# capture-readme-shots.mjs) turned into a short palette GIF. Needs pngquant,
# oxipng, ffmpeg and sips (macOS). Idempotent: run it after every capture.
#   scripts/optimize-readme-shots.sh [DIR]
set -euo pipefail
dir="${1:-$(cd "$(dirname "$0")/.." && pwd)/docs/readme}"
cd "$dir"

for png in *.png; do
  [ -f "$png" ] || continue
  width=$(sips -g pixelWidth "$png" | awk '/pixelWidth/ {print $2}')
  case "$png" in
    ios-*) ;; # the simulator shots arrive at their final size
    *) if [ "$width" -gt 1800 ]; then sips --resampleWidth 1800 "$png" >/dev/null; fi ;;
  esac
  pngquant --quality 70-95 --speed 1 --strip --force --ext .png "$png"
  oxipng -o 4 --strip safe --quiet "$png"
done

if [ -f mascots-clip.webm ]; then
  # the first seconds are the page loading; then 12 fps, 900 px wide, one palette: a light GIF that loops
  ffmpeg -v error -y -ss 2.5 -t 6 -i mascots-clip.webm -vf "fps=12,scale=900:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4" -loop 0 mascots.gif
fi

du -sh . | awk '{print "docs/readme:", $1}'
ls -l | awk 'NR > 1 {printf "%8d  %s\n", $5, $9}'

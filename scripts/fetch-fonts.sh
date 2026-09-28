#!/usr/bin/env bash
# Downloads the fonts Novig's own app ships (from their public QA Expo host) into ./fonts for local use.
# They are licensed typefaces: this folder is gitignored and must never be committed or redistributed.
set -euo pipefail
cd "$(dirname "$0")/.."
HOST="https://novig-mobile-app--qa.expo.app/assets/src/assets/fonts"
FILES=(
  "ABCMonumentGrotesk-Regular.7ce09a6b8b0ccd33bb5faa1adb8e4cd1.ttf"
  "ABCMonumentGrotesk-Medium.cc94c02e9c683511a05c0f94ed95dfca.ttf"
  "ABCMonumentGrotesk-Bold.3d00bf19e2dde9515eff8398f12eac70.ttf"
  "ABCMonumentGroteskSemiMono-Medium.20a745f10369401e9c703e6cf8a06141.otf"
  "OOTheran-Regular.677d1fded27883bd59d7451dbe668954.otf"
)
# Paper Mono is what docs.novig.com uses for code and figures.
EXTRA=(
  "https://docs.novig.com/mintlify-assets/_next/static/media/PaperMono_Variable.p.aa32f7a0.woff2 PaperMono.woff2"
)
mkdir -p fonts
for pair in "${EXTRA[@]}"; do
  url="${pair% *}"; name="${pair##* }"
  if [[ -s "fonts/$name" ]]; then echo "have   $name"; else curl -fsSL "$url" -o "fonts/$name" && echo "fetched $name"; fi
done
for f in "${FILES[@]}"; do
  name="${f%%.*}.${f##*.}"
  if [[ -s "fonts/$name" ]]; then echo "have   $name"; continue; fi
  curl -fsSL "$HOST/$f" -o "fonts/$name" && echo "fetched $name"
done

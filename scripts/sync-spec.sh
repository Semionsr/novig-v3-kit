#!/usr/bin/env bash
# Re-pulls Novig's OpenAPI spec and signing vectors. Exits 1 if either changed, so CI (or you)
# notices when the v3 docs move and the SDKs need a look. Regenerates TS types when they do.
set -euo pipefail
cd "$(dirname "$0")/.."
BASE="https://docs.novig.com/api-reference/spec-files"
changed=0
for f in openapi-v3-target.json signing-vectors.json; do
  tmp="$(mktemp)"
  curl -fsSL "$BASE/$f" -o "$tmp"
  if ! cmp -s "$tmp" "fixtures/$f"; then
    echo "changed: $f"
    mv "$tmp" "fixtures/$f"
    changed=1
  else
    echo "same:    $f"
    rm "$tmp"
  fi
done
if [[ $changed == 1 ]]; then
  (cd ts/packages/novig-v3 && pnpm -s gen:types)
  echo "Spec drift: rerun 'make test' and review the diff in fixtures/."
  exit 1
fi

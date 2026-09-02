#!/usr/bin/env bash
# Builds a Chrome-Web-Store-ready zip of extension/ at dist/fp-extension-v<version>.zip.
# Rebuilds the WASM engines first so the zip always matches the current
# rs-wasm source (requires wasm-pack — see rs-wasm/build.sh).
set -euo pipefail
cd "$(dirname "$0")/.."

echo "Building WASM engines..."
(cd rs-wasm && ./build.sh)

version="$(node -pe "require('./extension/manifest.json').version")"
mkdir -p dist
out="dist/fp-extension-v${version}.zip"
rm -f "$out"

echo "Zipping extension/ -> $out"
(cd extension && zip -rq "../$out" . -x '*.DS_Store' -x 'wasm/*/package.json' -x 'wasm/*/.gitignore')

echo "Done: $out"

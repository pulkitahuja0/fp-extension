#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

VARIANTS=(gen1 gen2 gen3 gen4 gen5 gen6 gen7 gen8 gen9 gen9-tera)

for v in "${VARIANTS[@]}"; do
  features="${v%-tera}"
  [[ "$v" == *-tera ]] && features="gen9,terastallization"
  echo "Building $v (features: $features)"
  wasm-pack build --target web --out-name engine \
    --out-dir "../extension/wasm/$v" \
    -- --no-default-features --features "$features"
done

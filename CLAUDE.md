# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Chrome (Manifest V3) extension that ports [foul-play](https://github.com/pmariglia/foul-play) (a Pokemon Showdown bot) into the browser: it reads the live battle state out of a Pokemon Showdown tab, predicts the opponent's likely sets, runs poke-engine's MCTS search in WASM, and shows the best move in the popup. Not published to the Chrome Web Store — always run as an unpacked extension.

Two halves of the repo:
- `extension/` — plain ES modules, no bundler, no build step, no test framework, no `package.json`. Loaded directly by Chrome.
- `rs-wasm/` — a Rust crate wrapping the vendored `poke-engine` (`rs-wasm/vendor/poke-engine`) for `wasm-bindgen`, compiled to per-generation WASM bundles.

## Commands

Build the WASM engines (required before the extension will run, and after any change to `rs-wasm/`):
```
cd rs-wasm
./build.sh
```
This builds ten variants (`gen1`...`gen9`, plus `gen9-tera`) via `wasm-pack build --target web`, each with a different Cargo feature set, and drops output into `extension/wasm/<variant>/` (gitignored). Requires `wasm-pack` on `PATH`.

To build/check a single variant manually (e.g. while iterating on `rs-wasm/src/lib.rs`):
```
cd rs-wasm
wasm-pack build --target web --out-name engine --out-dir ../extension/wasm/gen9-tera -- --no-default-features --features "gen9,terastallization"
cargo check   # fast type-check without the wasm-pack/wasm-bindgen step
```

Load/reload the extension: open `chrome://extensions`, enable Developer Mode, "Load unpacked" → select `extension/` (or click reload after rebuilding WASM / editing JS — MV3 does not hot-reload).

There is no lint, format, or JS test command in this repo — none are configured. Verify JS changes by reloading the extension and exercising it against a live Pokemon Showdown battle (`__foulPlayDebug()` is exposed on the page for inspecting the raw snapshot from devtools — see below).

## Architecture

### Execution contexts and how they talk to each other

Three separate JS worlds run per Showdown tab/popup, each with different global access, bridged by `postMessage`/`chrome.runtime` message passing:

1. **`page-bridge.js`** — injected into the page's **MAIN world**, so it alone can see Pokemon Showdown's own client globals (`window.PS`, `window.BattlePokedex`, `window.BattleMovedex`). Its only job is `buildSnapshot()`: scrape the live battle into a plain-JSON "snapshot" (both sides' Pokemon, field conditions, raw protocol `stepQueue`, dex metadata) on request. Exposed as `window.__foulPlayDebug()` for manual inspection from devtools.
2. **`content.js`** — the extension's **isolated world** content script for the same tab. Can reach `chrome.runtime` but not the page's `PS` global. Relays a `fp-get-snapshot` request from the popup to `page-bridge.js` via `window.postMessage` and returns the reply.
3. **`popup.js`** (+ everything under `extension/predict/` and `extension/inference/`) — runs in the **extension popup**. Requests a snapshot via `chrome.tabs.sendMessage`, then runs the full prediction/search pipeline and renders results. Has no DOM/page access of its own.

`extension/state-builder.js` is deliberately dependency-free from the PS client/DOM — it only knows how to turn a snapshot into poke-engine's wire format — so it (and the pipeline below it) can be reasoned about independently of the scraping logic in `page-bridge.js`.

### Prediction pipeline (`popup.js` orchestrates, on "Calculate best move")

1. Get a snapshot from the active tab (`content.js` → `page-bridge.js`).
2. **Inference** (`extension/inference/`): replay the snapshot's raw `stepQueue` protocol log to narrow down the opponent's hidden information — speed range, Hidden Power type, impossible items/abilities, Choice Scarf, Heavy Duty Boots. `inference/index.js` orchestrates the individual signal modules; split into event-only signals (safe to scan the whole log) vs. state-dependent signals (only valid against the current/last-turn position). Results are hard filters/priors for sampling, not part of the search state itself.
3. **World sampling** (`extension/predict/worlds.js`, using `predictor.js`, `smogon-sets.js`, `team-datasets.js`, `moveset-sampling.js`): draws N independent full hypothesis teams for the opponent ("worlds"), each filling in unrevealed species/ability/item/nature/EVs/moves by sampling from Smogon usage stats and foul-play's own hosted dataset (`foulplay-cc.js`, `data.foulplay.cc`), respecting the inference constraints from step 2. This mirrors foul-play's `fp/search/standard_battles.py`.
4. **State building** (`state-builder.js`): each sampled world's opponent side + the known side is serialized into poke-engine's pipe-delimited `State::deserialize` format (see `rs-wasm/vendor/poke-engine/src/state.rs` for the exact field order this mirrors).
5. **Search** (`wasm-loader.js`, `predict/mcts-pool.js`, `predict/mcts-worker.js`): each world's state is searched independently and concurrently across Web Workers (one poke-engine WASM instance per worker — the WASM engine itself is single-threaded, so this is the extension's substitute for foul-play's `ProcessPoolExecutor`). `wasm-loader.js` picks the right per-generation WASM variant (and gen9 tera vs. non-tera) for the battle's format.
6. **Aggregation** (`predict/aggregate.js`): blends the N worlds' move-visit distributions into one final ranked choice — weighted by world weight and each world's visit share, then a weighted-random pick among near-top survivors (not argmax) — port of foul-play's `select_move_from_mcts_results`. This cross-world blending step, not any single world's raw MCTS output, is the actual "decide what to do" algorithm.

Most modules carry a comment at the top naming the specific foul-play Python file/function they port — check there first when behavior seems to diverge from foul-play, since the intent is fidelity to that reference implementation, not independent design.

### rs-wasm

`rs-wasm/src/lib.rs` exposes two `wasm_bindgen` functions consumed via `wasm-loader.js`:
- `best_move(state_str, max_iterations)` — runs poke-engine's MCTS, always by iteration count (never wall-clock time).
- `damage_rolls(state_str, side_one_move, side_two_move, side_one_moves_first)` — computes damage-roll windows for one hypothetical exchange without a search; used by `extension/inference/damage-check.js` to test a hypothesized opponent set against an observed damage instance.

poke-engine's ruleset (which generation's mechanics apply) is a **compile-time Cargo feature**, not a runtime switch — hence one WASM binary per generation (`rs-wasm/Cargo.toml`'s `[features]`, built by `build.sh`'s loop) rather than a single build with a generation parameter.

`rs-wasm/vendor/poke-engine` is a vendored copy of the poke-engine crate, not a git submodule — treat it as upstream source to read for reference (e.g. wire format, `MoveChoice::to_string()` semantics), not a place to casually diverge from without noting why.

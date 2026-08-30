# Vendored poke-engine

Source: https://github.com/pmariglia/poke-engine
Pinned commit: `bcf13823abc162a608e187b26bbf683f759f385e` (tag `v0.0.48`)

Vendored (rather than a plain `git`/`rev` Cargo dependency) so this crate builds
fully offline/reproducibly and so the wasm-compatibility patch below can be
applied. Only `src/`, `Cargo.toml`, and `LICENSE` were copied; `data/`,
`poke-engine-py/`, `tests/`, and the `[[bin]]` targets (`poke-engine`,
`benchmark`) were dropped since we only use this crate as a library.

## Patch: `Instant` on wasm32-unknown-unknown

`src/mcts.rs`'s `run_mcts_loop` calls `std::time::Instant::now()`
unconditionally on every search — even when using the iteration-count search
limit rather than the time limit. `std::time::Instant::now()` panics at
runtime on the `wasm32-unknown-unknown` target (no OS clock in that
environment), so calling `perform_mcts` from a browser would panic
immediately.

Fix: swap `std::time::Instant` for the `web-time` crate's drop-in
replacement, which is implemented via `performance.now()` in-browser and
behaves like `std::time::Instant` everywhere else.

Diff (both in `src/mcts.rs`):

```diff
 use std::collections::HashMap;
 use std::time::Duration;
+use web_time::Instant;
```

```diff
-    let start_time = std::time::Instant::now();
+    let start_time = Instant::now();
```

Plus `web-time = "0.2"` added to `[dependencies]` in `Cargo.toml`.

No other files were modified. `src/mcts_threaded.rs` (multi-threaded MCTS,
uses `std::thread::scope`) is untouched and unused by `rs-wasm` — it still
compiles for `wasm32-unknown-unknown` (thread/atomic types exist on that
target), it just isn't functional there, which is fine since we never call it.

## Updating the pinned commit

To move to a newer poke-engine commit: re-clone at the new commit, re-copy
`src/`, `Cargo.toml`, and `LICENSE` over this directory, re-apply the two-line
diff above to the new `src/mcts.rs`, re-add `web-time` to the new
`Cargo.toml`, and update the commit/tag noted at the top of this file.

# Foul Play Extension

A Chrome extension port of [the Foul Play showdown bot](https://github.com/pmariglia/foul-play): reads the current Pokemon Showdown battle, predicts what the opponent's Pokemon are running, and searches for the best move with [poke-engine](https://github.com/pmariglia/poke-engine) compiled to WebAssembly — all in the browser, no server required.

Currently available on the [Chrome Web Store](https://chromewebstore.google.com/detail/foul-play-extension/pfaplgkifnonejmjdnpognfengonijai), or free to build from source.

## Usage

1. Open a battle at `play.pokemonshowdown.com`.
2. Click the extension's icon to open the popup, pick a search budget, and click "Calculate best move."
3. The popup shows a ranked list of your options and the opponent's likely response, blended across several sampled hypotheses about the opponent's unrevealed team.

## Building

Requires [`wasm-pack`](https://rustwasm.github.io/wasm-pack/) and Node.

```
git clone https://github.com/pulkitahuja0/fp-extension
cd fp-extension
npm install
npm run build:wasm
```

Then open `chrome://extensions`, enable Developer Mode, and "Load unpacked" → select the `extension/` directory. Reload the extension from that page after rebuilding the WASM engines or editing any extension JS.

## Development

```
npm run lint          # oxlint
npm run format        # oxfmt --write
npm run format:check  # oxfmt --check
npm run check         # lint + format:check
```

There is no JS test suite; verify changes by reloading the extension and exercising it against a live battle. `window.__foulPlayDebug()` is available from a Pokemon Showdown tab's devtools console to inspect the raw battle snapshot the extension sees.

See [CLAUDE.md](CLAUDE.md) for an architecture overview.

## License

GPL-3.0 — see [LICENSE](LICENSE).

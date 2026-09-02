# Privacy Policy

Foul Play Extension does not collect, store, or transmit any personal data, and has no analytics, telemetry, or remote logging of any kind.

## What the extension reads

While its popup is open and you click "Calculate best move," the extension reads the current battle state from the active `play.pokemonshowdown.com` tab (`extension/page-bridge.js`): both teams' species, moves, HP, status, and the battle's field conditions. This data is used only to build a local search state in memory for that one calculation and is never written to disk or sent anywhere. It is discarded once the popup closes.

## Network requests

The extension makes outbound requests to exactly three hosts, declared in `extension/manifest.json`'s `host_permissions`, all unauthenticated `GET` requests to public JSON endpoints with no battle or user data in the request:

| Host                       | Purpose                                                                                                                               | Request contents               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `play.pokemonshowdown.com` | Fetch Pokemon Showdown's published common movesets for the battle's format (`extension/predict/ps-sets.js`)                           | Format id only (e.g. `gen9ou`) |
| `www.smogon.com`           | Fetch Smogon's public usage/"chaos" statistics for the battle's format (`extension/predict/smogon-sets.js`)                           | Format id and month only       |
| `data.foulplay.cc`         | Fetch foul-play's own hosted full-set and replay-derived moveset dataset for the battle's format (`extension/predict/foulplay-cc.js`) | Format id only                 |

None of these requests include the battle state, your Pokemon Showdown username, or any other identifying information — they only ever ask "what does everyone play in format X."

## Local storage

The `storage` permission is used solely to cache the responses above in `chrome.storage` (`extension/predict/cache.js`), so repeated calculations in the same format don't re-fetch the same public dataset. Nothing sensitive is cached, and nothing in this cache ever leaves the browser.

## What the extension does not do

- It does not require or use any account, login, or authentication.
- It does not use cookies, fingerprinting, or any cross-site tracking.
- It does not load or execute any remotely-hosted code — the WASM search engine (`rs-wasm/`) is compiled and bundled into the extension package itself, not fetched at runtime.
- It does not sell or share data with third parties, because it does not collect any.

## Contact

This extension is open source. Review the source or file an issue at the project's repository: https://github.com/pulkitahuja0/fp-extension.

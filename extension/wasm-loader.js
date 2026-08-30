// Loads the poke-engine wasm build matching a battle's generation/format.
//
// Each generation is a separate wasm binary (poke-engine's ruleset is a
// compile-time Cargo feature, not a runtime switch — see rs-wasm/build.sh),
// so callers pick a variant name and this module dynamically imports the
// matching bundle. All variants export the same `best_move(state, maxIterations)`
// function, so callers don't need to know which one they got past this point.
//
// Valid variant names: gen1, gen2, ..., gen9, gen9-tera (gen9 + Terastallization).

const loadedModules = new Map();

export async function loadEngine(variant) {
    if (loadedModules.has(variant)) {
        return loadedModules.get(variant);
    }

    const module = await import(`./wasm/${variant}/engine.js`);
    await module.default();
    loadedModules.set(variant, module);
    return module;
}

// Maps a Pokemon Showdown format id's generation (e.g. "gen9ou" -> 9) to the
// wasm variant that should handle it. `tera` only matters for gen 9, where
// poke-engine has separate terastallization/no-terastallization builds.
export function variantForFormat(formatId, { tera = true } = {}) {
    const match = /^gen(\d)/.exec(formatId);
    if (!match) {
        throw new Error(`Could not determine generation from format id: ${formatId}`);
    }
    const gen = match[1];
    return gen === "9" && tera ? "gen9-tera" : `gen${gen}`;
}

export async function bestMove(formatId, stateStr, maxIterations = 20000, options = {}) {
    const variant = variantForFormat(formatId, options);
    const engine = await loadEngine(variant);
    return engine.best_move(stateStr, maxIterations);
}

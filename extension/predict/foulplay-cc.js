// Fetches foul-play's own hosted dataset, exactly as fp/data/sets/team_datasets.py
// does: pokemon_full_sets.json (full sets — trait combo + exact moveset,
// same `tera|ability|item|nature|evs|move1|move2|...` pipe-delimited key
// shape ps-sets.js already produces, confirmed against the live endpoint)
// and replay_moves.json (species -> moveset co-occurrence counts, mined
// from replays — a broader movesets-only signal than pokemon_full_sets.json
// alone, used by extension/predict/moveset-sampling.js's step A). This
// service is undocumented beyond its URL shape (no public source for how
// it's built) — treated as an opaque data endpoint, matching how foul-play
// itself consumes it.
import { sessionCacheGet, sessionCacheSet } from './cache.js';

async function fetchJson(url) {
    try {
        const res = await fetch(url);
        if (!res.ok) return {};
        return await res.json();
    } catch {
        return {};
    }
}

async function cached(cacheKey, url) {
    const existing = await sessionCacheGet(cacheKey);
    if (existing) return existing;
    const data = await fetchJson(url);
    await sessionCacheSet(cacheKey, data);
    return data;
}

// { [speciesId]: { "tera|ability|item|nature|evs|move1|move2|...": count } }
export async function fetchFoulPlayCcFullSets(formatId) {
    return cached(`fp-foulplaycc-sets:${formatId}`, `https://data.foulplay.cc/${formatId}/pokemon_full_sets.json`);
}

// { [speciesId]: { "move1|move2|...|moveN (sorted)": count } }
export async function fetchFoulPlayCcMoves(formatId) {
    return cached(`fp-foulplaycc-moves:${formatId}`, `https://data.foulplay.cc/${formatId}/replay_moves.json`);
}

// Port of foul-play's fp/data/sets/randbats.py (RandomBattleTeamDatasets):
// random battle formats' opponent sets aren't reconstructed from usage
// stats or observed teams at all — Pokemon Showdown's own random-team
// generator draws each Pokemon from a fixed, per-species pool of full sets
// (level/item/ability/moves/tera all joined together), and pkmn.github.io's
// randbats project mirrors that exact pool with observed-frequency counts.
// Decodes into extension/predict/team-datasets.js's `bySpecies` shape
// (`{ [speciesId]: [{set, moves}, ...] }`) so extension/predict/random-worlds.js
// can sample it the same way that module samples full sets, just without
// team-datasets.js's Smogon-derived ability/item/moveset independence.
import { toId } from './normalize.js';
import { sessionCacheGet, sessionCacheSet } from './cache.js';

// randombattle_evs from fp/generations.py's GenerationMechanics — every
// standard-tier random battle format (Champions formats aside, which this
// repo doesn't otherwise support — see extension/predict/generations.js)
// uses this flat spread.
const RANDBATS_EVS = [85, 85, 85, 85, 85, 85];
const RANDBATS_NATURE = 'serious';

async function fetchRandbatsJson(formatId) {
    try {
        const res = await fetch(`https://pkmn.github.io/randbats/data/full/${formatId}.json`);
        if (!res.ok) return {};
        return await res.json();
    } catch {
        return {};
    }
}

// "level,item,ability,move1,move2,move3,move4[,teraType]" -> {set, moves},
// mirroring randbats.py's `_initialize_pkmn_sets` split-on-comma decoding.
function decodeSetKey(key, count) {
    const parts = key.split(',');
    const level = parseInt(parts[0], 10) || 100;
    const item = toId(parts[1]);
    const ability = toId(parts[2]);
    const moves = parts.slice(3, 7).filter(Boolean).map(toId);
    const teraType = parts[7] ? toId(parts[7]) : 'typeless';
    return {
        set: { ability, item, nature: RANDBATS_NATURE, evs: RANDBATS_EVS, teraType, level, count },
        moves,
    };
}

// { [speciesId]: [{ set, moves }, ...] }, sorted by count descending — same
// shape as team-datasets.js's bySpecies, but keyed on randbats' own species
// ids, which (unlike Smogon/PS data) break Mega Evolution formes out as
// their own top-level key (e.g. "charizardmegax") since a randbats set is
// really "this Pokemon holds this Mega Stone", not a separate species.
export async function buildRandbatsData(formatId) {
    const cacheKey = `fp-randbats:${formatId}`;
    const cached = await sessionCacheGet(cacheKey);
    if (cached) return cached;

    const raw = await fetchRandbatsJson(formatId);
    const bySpecies = {};
    for (const [rawName, sets] of Object.entries(raw)) {
        const species = toId(rawName);
        bySpecies[species] = Object.entries(sets)
            .map(([key, count]) => decodeSetKey(key, count))
            .sort((a, b) => b.set.count - a.set.count);
    }

    await sessionCacheSet(cacheKey, bySpecies);
    return bySpecies;
}

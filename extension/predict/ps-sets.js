// Port of foul-play's fp/data/sets/team_datasets.py's get_ps_sets_file:
// Pokemon Showdown ships its own curated example sets per format at
// data/sets/<format>.json (a `dex` table of Smogon-analysis sets plus a
// `stats` table of top-usage sets). Unlike Smogon's chaos stats, these are
// full sets — ability/item/nature/EVs/moves all joined together — so they
// slot directly into team-datasets.js's pool.
import { toId } from './normalize.js';
import { sessionCacheGet, sessionCacheSet } from './cache.js';

const EV_STATS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

function addSet(dest, species, setKey, weight) {
    dest[species] = dest[species] || {};
    dest[species][setKey] = (dest[species][setKey] || 0) + weight;
}

function collect(dest, table, weight) {
    for (const [name, sets] of Object.entries(table || {})) {
        const species = toId(name);
        for (const set of Object.values(sets)) {
            const moves = [...(set.moves || [])].map(toId).sort().join('|');
            const ability = toId(set.ability || 'noability');
            const item = toId(set.item || 'none');
            const nature = toId(set.nature || 'serious');
            const teraType = toId(set.teraType || '');
            // Older-gen sets have no `evs` object at all — treat as maxed,
            // matching get_ps_sets_file's own comment on this quirk.
            const evsSource = set.evs || { hp: 252, atk: 252, def: 252, spa: 252, spd: 252, spe: 252 };
            const evs = EV_STATS.map((stat) => evsSource[stat] || 0).join(',');
            addSet(dest, species, `${teraType}|${ability}|${item}|${nature}|${evs}|${moves}`, weight);
        }
    }
}

async function fetchPsSetsJson(formatId) {
    try {
        const res = await fetch(`https://play.pokemonshowdown.com/data/sets/${formatId}.json`);
        if (!res.ok) return {};
        return await res.json();
    } catch (e) {
        return {};
    }
}

// { [speciesId]: { "tera|ability|item|nature|evs|moves": count } }
export async function fetchPsSets(formatId) {
    const cacheKey = `fp-pssets:${formatId}`;
    const cached = await sessionCacheGet(cacheKey);
    if (cached) return cached;

    const json = await fetchPsSetsJson(formatId);
    const result = {};
    collect(result, json.dex, 1);
    collect(result, json.stats, 1);

    await sessionCacheSet(cacheKey, result);
    return result;
}

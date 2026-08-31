// Port of foul-play's fp/data/sets/team_datasets.py (TeamDatasets): merges
// Pokemon Showdown's own curated sets (ps-sets.js), foul-play's own hosted
// full-set + replay-derived movesets dataset (foulplay-cc.js), and the
// user's hardcoded teams (hardcoded-teams.js) into one pool of *full* sets —
// trait combo and exact moveset joined, unlike Smogon's marginal-only data.
// PS sets and foulplay.cc sets are summed by exact matching set-string
// before being decoded (mirrors _get_sets_dict adding the two dicts
// together by count); a hardcoded team gets a fixed high weight so a
// recognized team dominates generic curated sets.
import { fetchPsSets } from './ps-sets.js';
import { fetchFoulPlayCcFullSets, fetchFoulPlayCcMoves } from './foulplay-cc.js';
import { loadHardcodedTeams } from './hardcoded-teams.js';
import { fullSetMakesSense } from './set-rules.js';
import { toId } from './normalize.js';

const HARDCODED_TEAM_WEIGHT = 1000;

function mergeCounts(dest, source) {
    for (const [species, sets] of Object.entries(source || {})) {
        dest[species] = dest[species] || {};
        for (const [key, count] of Object.entries(sets)) {
            dest[species][key] = (dest[species][key] || 0) + count;
        }
    }
}

// Splits "tera|ability|item|nature|evs|move1|move2|move3|move4" into a
// PredictedPokemonSet-shaped {set, moves}. Moves are everything from index 5
// onward — NOT a fixed-position 6th field — since a set can carry 1-4 moves.
function decodeSetKey(key, count) {
    const parts = key.split('|');
    const [teraType, ability, item, nature, evsStr] = parts;
    const moves = parts.slice(5).filter(Boolean);
    return {
        set: { ability, item, nature, evs: (evsStr || '').split(',').map(Number), teraType: teraType || 'typeless', count },
        moves,
    };
}

// { [speciesId]: [{moves: string[], count: number}, ...] }
function decodeMovesets(raw) {
    const result = {};
    for (const [rawSpecies, entries] of Object.entries(raw || {})) {
        const species = toId(rawSpecies);
        result[species] = Object.entries(entries).map(([key, count]) => ({ moves: key.split('|').filter(Boolean), count }));
    }
    return result;
}

// { bySpecies: { [speciesId]: [{ set, moves }, ...] }, hardcodedTeams: [[Pokemon, ...], ...], movesets: { [speciesId]: [{moves, count}] } }
export async function buildTeamDatasets(formatId) {
    const [psSets, foulPlaySets, foulPlayMoves] = await Promise.all([
        fetchPsSets(formatId),
        fetchFoulPlayCcFullSets(formatId),
        fetchFoulPlayCcMoves(formatId),
    ]);

    const merged = {};
    mergeCounts(merged, psSets);
    mergeCounts(merged, foulPlaySets);

    const bySpecies = {};
    for (const [species, sets] of Object.entries(merged)) {
        bySpecies[species] = Object.entries(sets).map(([key, count]) => decodeSetKey(key, count));
    }

    const hardcodedTeams = await loadHardcodedTeams(formatId);
    for (const team of hardcodedTeams) {
        for (const pkmn of team) {
            bySpecies[pkmn.species] = bySpecies[pkmn.species] || [];
            bySpecies[pkmn.species].push({
                set: {
                    ability: pkmn.ability,
                    item: pkmn.item,
                    nature: pkmn.nature,
                    evs: pkmn.evs,
                    teraType: pkmn.teraType || 'typeless',
                    count: HARDCODED_TEAM_WEIGHT,
                },
                moves: pkmn.moves,
            });
        }
    }

    for (const sets of Object.values(bySpecies)) {
        sets.sort((a, b) => b.set.count - a.set.count);
    }

    return { bySpecies, hardcodedTeams, movesets: decodeMovesets(foulPlayMoves) };
}

function candidateAllowed(candidate, revealed, impossible) {
    if (revealed.ability && candidate.set.ability !== revealed.ability) return false;
    if (revealed.item && candidate.set.item !== revealed.item) return false;
    if (revealed.moves.some((mv) => !candidate.moves.includes(mv))) return false;
    if (impossible) {
        if (impossible.abilities && impossible.abilities.has(candidate.set.ability)) return false;
        if (impossible.items && impossible.items.has(candidate.set.item)) return false;
    }
    return true;
}

// Port of full_set_pkmn_can_have_set, extended to also respect the
// impossible-item/ability sets extension/inference/index.js derives. Every
// candidate still consistent with what's revealed (and not yet ruled out by
// inference), highest-weight first.
export function matchingFullSets(bySpecies, speciesKey, revealed, moveMeta, impossible) {
    const sets = bySpecies[speciesKey];
    if (!sets) return [];
    return sets.filter((c) => candidateAllowed(c, revealed, impossible) && fullSetMakesSense(c.set, c.moves, moveMeta));
}

export function findMatchingFullSet(bySpecies, speciesKey, revealed, moveMeta, impossible) {
    return matchingFullSets(bySpecies, speciesKey, revealed, moveMeta, impossible)[0] || null;
}

// Uniform-random pick among matching full sets — foul-play's TeamDatasets
// sampling deliberately does NOT weight by count ("counts aren't indicative
// of the actual distribution of sets" per fp/search/standard_battles.py).
export function sampleFullSet(bySpecies, speciesKey, revealed, moveMeta, impossible) {
    const candidates = matchingFullSets(bySpecies, speciesKey, revealed, moveMeta, impossible);
    if (!candidates.length) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
}

// Port of foul-play's fp/data/sets/team_datasets.py (TeamDatasets): merges
// Pokemon Showdown's own curated sets (ps-sets.js) with the user's
// hardcoded teams (hardcoded-teams.js) into one pool of *full* sets — trait
// combo and exact moveset joined, unlike Smogon's marginal-only data. A
// hardcoded team gets a fixed high weight so a recognized team dominates
// generic curated sets, mirroring how _get_sets_dict adds ps_sets and
// foulplay.cc's replay-derived full_sets together by count.
import { fetchPsSets } from './ps-sets.js';
import { loadHardcodedTeams } from './hardcoded-teams.js';
import { fullSetMakesSense } from './set-rules.js';

const HARDCODED_TEAM_WEIGHT = 1000;

function decodeSetKey(key, count) {
    const [teraType, ability, item, nature, evsStr, movesStr] = key.split('|');
    return {
        set: { ability, item, nature, evs: evsStr.split(',').map(Number), teraType: teraType || 'typeless', count },
        moves: movesStr ? movesStr.split('|') : [],
    };
}

// { bySpecies: { [speciesId]: [{ set, moves }, ...] }, hardcodedTeams: [[Pokemon, ...], ...] }
export async function buildTeamDatasets(formatId) {
    const bySpecies = {};

    const psSets = await fetchPsSets(formatId);
    for (const [species, sets] of Object.entries(psSets)) {
        bySpecies[species] = bySpecies[species] || [];
        for (const [key, count] of Object.entries(sets)) {
            bySpecies[species].push(decodeSetKey(key, count));
        }
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

    return { bySpecies, hardcodedTeams };
}

// Port of full_set_pkmn_can_have_set: the highest-weighted full set that's
// still consistent with whatever's already been revealed about this
// Pokemon (ability/item must match if known; every revealed move must be
// part of the candidate's moveset).
export function findMatchingFullSet(bySpecies, speciesKey, revealed, moveMeta) {
    const sets = bySpecies[speciesKey];
    if (!sets) return null;
    for (const candidate of sets) {
        if (revealed.ability && candidate.set.ability !== revealed.ability) continue;
        if (revealed.item && candidate.set.item !== revealed.item) continue;
        if (revealed.moves.some((mv) => !candidate.moves.includes(mv))) continue;
        if (!fullSetMakesSense(candidate.set, candidate.moves, moveMeta)) continue;
        return candidate;
    }
    return null;
}

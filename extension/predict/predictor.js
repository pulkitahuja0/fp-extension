// Data-fetching/caching bootstrap plus single-Pokemon sampling primitives —
// mirrors foul-play's fp/data/sets (dataset access) and the per-Pokemon
// sampling half of fp/search/standard_battles.py's sample_pokemon. Multi-
// world orchestration (sampling N full hypothesis opponent teams) lives in
// extension/predict/worlds.js, which calls the functions here once per
// Pokemon per world.
import { resolveKey } from './species-match.js';
import { buildSmogonData, sampleTraitCombo } from './smogon-sets.js';
import { buildTeamDatasets, sampleFullSet } from './team-datasets.js';
import { sampleMoveset } from './moveset-sampling.js';
import { fullSetMakesSense } from './set-rules.js';

const DEFAULT_LEVEL = 100;
// Even when a full matching set exists, sometimes skip straight to Smogon
// sampling for variety across worlds — matches fp/search/standard_battles.py's
// sample_pokemon (only applied once at least one move is already known).
const FULL_SET_TRY_RATE = 0.75;

export async function loadPredictionData(formatId) {
    const [smogonData, teamDatasets] = await Promise.all([buildSmogonData(formatId), buildTeamDatasets(formatId)]);
    return { smogonData, teamDatasets };
}

function revealedInfo(pkmn) {
    return {
        ability: pkmn.ability || null,
        item: pkmn.item || null,
        moves: (pkmn.moves || []).map((m) => m.id).filter(Boolean),
    };
}

function impossibleFor(pkmn) {
    return { items: pkmn.impossibleItems || new Set(), abilities: pkmn.impossibleAbilities || new Set() };
}

function realMovesetsFor(speciesKey, teamDatasets) {
    const fromReplays = teamDatasets.movesets[speciesKey] || [];
    const fromFullSets = (teamDatasets.bySpecies[speciesKey] || []).map((s) => ({
        moves: s.moves,
        count: s.set.count,
    }));
    return fromReplays.concat(fromFullSets);
}

// Returns one sampled {set, moves} prediction for this Pokemon (species
// already known), respecting whatever's already revealed/ruled-out, or null
// if no data source has anything usable for this species.
export function samplePokemonSet(pkmn, { smogonData, teamDatasets, moveMeta }) {
    const revealed = revealedInfo(pkmn);
    const impossible = impossibleFor(pkmn);

    const fullSetKey = resolveKey(pkmn.species, pkmn.baseSpecies, teamDatasets.bySpecies);
    if (fullSetKey && (!revealed.moves.length || Math.random() < FULL_SET_TRY_RATE)) {
        const fullSet = sampleFullSet(teamDatasets.bySpecies, fullSetKey, revealed, moveMeta, impossible);
        if (fullSet) return fullSet;
    }

    const smogonKey = resolveKey(pkmn.species, pkmn.baseSpecies, smogonData);
    if (!smogonKey) return null;
    const combo = sampleTraitCombo(smogonData[smogonKey], revealed, impossible);
    if (!combo) return null;
    const moves = sampleMoveset(
        revealed.moves,
        realMovesetsFor(smogonKey, teamDatasets),
        smogonData[smogonKey].moveUsage,
        combo,
        moveMeta
    );
    if (!fullSetMakesSense(combo, moves, moveMeta)) return null;
    return { set: combo, moves };
}

// Mutates `pkmn` in place with a sampled prediction's ability/item/tera/
// nature/EVs/moves, never overwriting anything already known.
export function applySampledSet(pkmn, prediction) {
    if (!prediction) return;
    const { set, moves } = prediction;
    if (!pkmn.ability) pkmn.ability = set.ability;
    if (!pkmn.item) pkmn.item = set.item;
    if (!pkmn.teraType && set.teraType && set.teraType !== 'typeless') pkmn.teraType = set.teraType.toUpperCase();
    pkmn.predictedNature = set.nature;
    pkmn.predictedEvs = set.evs;

    const known = new Set((pkmn.moves || []).map((m) => m.id).filter(Boolean));
    const emptySlots = (pkmn.moves || []).filter((m) => !m.id);
    for (const mv of moves) {
        if (known.has(mv)) continue;
        const slot = emptySlots.shift();
        if (!slot) break;
        slot.id = mv;
        slot.pp = null;
        slot.maxpp = null;
        known.add(mv);
    }
}

// One weighted-random draw of `slotCount` still-unidentified species for
// this world — port of fp/search/standard_battles.py's
// sample_standardbattle_pokemon / predict_team_likelihood: weighted-sample
// from average pairwise Smogon teammate co-occurrence among the top 50
// candidates, updating the "identified" set after each pick so later picks
// account for earlier ones.
export function sampleRemainingSpecies(identifiedIds, smogonData, slotCount) {
    const picks = [];
    const identified = new Set(identifiedIds);
    for (let i = 0; i < slotCount; i++) {
        const scores = new Map();
        for (const id of identified) {
            const entry = smogonData[id];
            if (!entry) continue;
            for (const [teammate, count] of Object.entries(entry.teammates)) {
                if (identified.has(teammate)) continue;
                const priorUsage = smogonData[id].rawCount || 1;
                scores.set(teammate, (scores.get(teammate) || 0) + count / priorUsage);
            }
        }
        const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50);
        if (!ranked.length) break;
        const total = ranked.reduce((sum, [, score]) => sum + score, 0);
        let r = Math.random() * total;
        let chosen = ranked[ranked.length - 1][0];
        for (const [species, score] of ranked) {
            r -= score;
            if (r <= 0) {
                chosen = species;
                break;
            }
        }
        picks.push(chosen);
        identified.add(chosen);
    }
    return picks;
}

export function buildGuessedPokemon(species, level, dexMeta) {
    const meta = dexMeta[species];
    if (!meta) return null;
    return {
        species,
        baseSpecies: meta.baseSpecies || null,
        level,
        baseTypes: meta.types,
        types: meta.types,
        hp: null,
        maxhp: null,
        hpPercent: 100, // never seen — assume full health
        fainted: false,
        ability: '',
        item: '',
        status: '',
        sleepTurns: null,
        boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0 },
        moves: [0, 1, 2, 3].map(() => ({ id: '', pp: null, maxpp: null, disabled: false })),
        terastallized: false,
        teraType: null,
        megaEvolved: false,
        weightkg: meta.weightkg,
        volatiles: [],
        statsExact: null,
        baseStats: meta.baseStats,
    };
}

export { DEFAULT_LEVEL };

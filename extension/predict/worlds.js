// Port of fp/search/standard_battles.py's prepare_battles: builds N
// independent hypothesis worlds for the opponent's side — each a full guess
// of every unrevealed species/set — for extension/predict/mcts-pool.js to
// search independently. Runs extension/inference/*.js once (the narrowing
// it derives from the observed battle log is the same regardless of which
// hypothesis world we're about to sample) and applies its impossible-item/
// ability/speed-range/Hidden-Power constraints as hard filters during
// sampling.

import { runInference, applyInference } from '../inference/index.js';
import { toId } from './normalize.js';
import { calcStat } from '../state-builder.js';
import { natureMultiplier } from './natures.js';
import {
    samplePokemonSet,
    applySampledSet,
    sampleRemainingSpecies,
    buildGuessedPokemon,
    DEFAULT_LEVEL,
} from './predictor.js';

const SPEED_RETRY_ATTEMPTS = 5;

function cloneOppSide(oppSide) {
    return structuredClone(oppSide);
}

function speedStatFor(pkmn, set) {
    const ev = (set.evs && set.evs[5]) || 0;
    return calcStat(pkmn.baseStats.spe, pkmn.level, false, 31, ev, natureMultiplier(set.nature, 'spe'));
}

function inSpeedRange(pkmn, prediction) {
    if (!pkmn.speedRange || !prediction) return true;
    const stat = speedStatFor(pkmn, prediction.set);
    return stat >= pkmn.speedRange.min && stat <= pkmn.speedRange.max;
}

// Samples a full set for `pkmn`, retrying a few times if the result doesn't
// fit a speed range extension/inference/speed-range.js already narrowed —
// falls back to the last attempt if nothing fits (better a slightly-wrong
// sample than an empty one).
function samplePokemonSetInRange(pkmn, context) {
    let prediction = null;
    for (let attempt = 0; attempt < SPEED_RETRY_ATTEMPTS; attempt++) {
        prediction = samplePokemonSet(pkmn, context);
        if (inSpeedRange(pkmn, prediction)) break;
    }
    return prediction;
}

// Best-effort mega-evolution sampling — port of the core of
// BattleMode.sample_mega_evolution: if this Pokemon's base species has a
// mega form with usage data showing it's actually more common than staying
// base, weighted-sample whether to apply it. Silently does nothing if usage
// data for the mega form isn't available (older/rare formats, or a
// non-mega-capable species) — this is a lower-priority signal than set
// prediction itself, not worth failing sampling over.
function maybeSampleMega(pkmn, { smogonData, dexMeta, gen }) {
    if (!gen.megasExist || pkmn.megaEvolved || pkmn.item) return;
    const baseSpecies = pkmn.baseSpecies || pkmn.species;
    const candidates = ['mega', 'megax', 'megay']
        .map((suffix) => `${baseSpecies}${suffix}`)
        .filter((id) => dexMeta[id] && dexMeta[id].requiredItem);
    if (!candidates.length) return;

    const baseUsage = (smogonData[baseSpecies] && smogonData[baseSpecies].rawCount) || 0;
    const options = candidates.map((id) => ({ id, usage: (smogonData[id] && smogonData[id].rawCount) || 0 }));
    const total = options.reduce((sum, o) => sum + o.usage, 0) + baseUsage;
    if (total <= 0) return;

    let r = Math.random() * total;
    for (const o of options) {
        r -= o.usage;
        if (r <= 0) {
            const meta = dexMeta[o.id];
            pkmn.item = meta.requiredItem;
            pkmn.megaEvolved = true;
            pkmn.species = o.id;
            pkmn.types = meta.types;
            pkmn.baseTypes = meta.types;
            pkmn.baseStats = meta.baseStats;
            pkmn.weightkg = meta.weightkg;
            return;
        }
    }
    // else: base form "wins" the draw — leave pkmn untouched
}

// `snapshot` needs stepQueue/mySideId (page-bridge.js) and moveMeta/dexMeta.
// `predictionData` is predictor.js's loadPredictionData() result. Returns
// [{ oppSide, weight }, ...], `numWorlds` entries, weight = 1/numWorlds
// (uniform, matching foul-play's prepare_battles).
export function sampleWorlds(snapshot, predictionData, gen, numWorlds) {
    const inference = runInference(snapshot, gen);
    const { smogonData, teamDatasets } = predictionData;
    const { moveMeta, dexMeta } = snapshot;
    const context = { smogonData, teamDatasets, moveMeta };

    const worlds = [];
    for (let i = 0; i < numWorlds; i++) {
        const oppSide = cloneOppSide(snapshot.oppSide);
        applyInference(oppSide, inference);

        const revealedPokemon = oppSide.pokemon.filter(Boolean);
        for (const pkmn of revealedPokemon) {
            maybeSampleMega(pkmn, { smogonData, dexMeta, gen });
            applySampledSet(pkmn, samplePokemonSetInRange(pkmn, context));
        }

        const identifiedIds = new Set(revealedPokemon.map((p) => toId(p.species)));
        const emptySlotCount = oppSide.pokemon.reduce((n, p) => n + (p ? 0 : 1), 0);
        if (emptySlotCount > 0) {
            const level = revealedPokemon[0] ? revealedPokemon[0].level : DEFAULT_LEVEL;
            const guesses = sampleRemainingSpecies(identifiedIds, smogonData, emptySlotCount);
            let guessIndex = 0;
            for (let slot = 0; slot < oppSide.pokemon.length && guessIndex < guesses.length; slot++) {
                if (oppSide.pokemon[slot]) continue;
                const species = guesses[guessIndex++];
                const pkmn = buildGuessedPokemon(species, level, dexMeta);
                if (!pkmn) continue;
                maybeSampleMega(pkmn, { smogonData, dexMeta, gen });
                applySampledSet(pkmn, samplePokemonSet(pkmn, context));
                oppSide.pokemon[slot] = pkmn;
            }
        }

        worlds.push({ oppSide, weight: 1 / numWorlds });
    }
    return worlds;
}

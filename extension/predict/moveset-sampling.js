// Port of fp/search/standard_battles.py's sample_pokemon_moveset_with_known_pkmn_set's
// two-stage moveset completion, once a "set shell" (ability/item/nature/EVs,
// not necessarily all 4 moves) has already been chosen for one sampled
// world:
//  Step A: sample from real observed movesets (extension/predict/team-datasets.js's
//    per-species pool — PS sets + data.foulplay.cc + hardcoded teams),
//    weighted by count, restricted to movesets consistent with what's
//    already revealed.
//  Step B (only if step A found nothing, or didn't reach 4 moves): fill
//    remaining slots by independent per-move Bernoulli sampling from Smogon
//    move-usage rates, using the `1 - (1-p)^(1/n)` correction that converts
//    "usage rate across a 4-move set" into a per-slot independent-trial
//    probability, re-validated against set-rules.js after each add.
//
// Not replicated: foul-play additionally reweights step-A candidates by how
// many of their moves are already revealed (count *2 at 3 known, *3 at 4
// known). In foul-play's implementation that reweighting only scales step
// A's candidate pool uniformly (every surviving candidate already contains
// every revealed move, by construction) rather than changing which
// candidate step A picks, so it's skipped here as a no-op simplification.

import { fullSetMakesSense } from './set-rules.js';

function weightedChoice(items, weightOf) {
    const total = items.reduce((sum, it) => sum + Math.max(0, weightOf(it)), 0);
    if (total <= 0) return items[Math.floor(Math.random() * items.length)];
    let r = Math.random() * total;
    for (const it of items) {
        r -= Math.max(0, weightOf(it));
        if (r <= 0) return it;
    }
    return items[items.length - 1];
}

function sampleFromRealMovesets(revealedMoves, realMovesets) {
    const candidates = (realMovesets || []).filter((m) => revealedMoves.every((mv) => m.moves.includes(mv)));
    if (!candidates.length) return null;
    return weightedChoice(candidates, (c) => c.count).moves;
}

function adjustProbability(p, numMoves) {
    return 1 - Math.pow(1 - p, 1 / numMoves);
}

function sampleFromUsageRates(existingMoves, moveUsageRates, set, moveMeta, targetCount) {
    const moves = [...existingMoves];
    for (const [mv, rate] of moveUsageRates) {
        if (moves.length >= targetCount) break;
        if (moves.includes(mv)) continue;
        const chance = adjustProbability(rate, targetCount);
        if (Math.random() < chance) {
            const candidate = [...moves, mv];
            if (fullSetMakesSense(set, candidate, moveMeta)) moves.push(mv);
        }
    }
    return moves;
}

// `revealedMoves`: string[] already known for this Pokemon (order-independent).
// `realMovesets`: [{moves: string[], count: number}, ...] for this species
//   (extension/predict/team-datasets.js's bySpecies entries).
// `moveUsageRates`: [[moveId, rate], ...] sorted descending, from
//   extension/predict/smogon-sets.js's per-species moveUsage.
// `set`/`moveMeta`: passed straight through to set-rules.js's fullSetMakesSense.
export function sampleMoveset(revealedMoves, realMovesets, moveUsageRates, set, moveMeta) {
    if (revealedMoves.length >= 4) return revealedMoves.slice(0, 4);

    let moves = sampleFromRealMovesets(revealedMoves, realMovesets) || [...revealedMoves];
    if (moves.length < 4 && moveUsageRates && moveUsageRates.length) {
        moves = sampleFromUsageRates(moves, moveUsageRates, set, moveMeta, 4);
    }
    return moves.slice(0, 4);
}

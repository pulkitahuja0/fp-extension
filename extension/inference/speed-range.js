// Port of fp/battle/inference.py's check_speed_ranges: after a turn where
// both sides used equal-priority moves (and nothing else confounds turn
// order), whoever went first must have had >= the other's effective speed —
// this bounds the opponent's raw speed stat without assuming any item.
//
// Simplification vs foul-play's version: the raw protocol log already
// reflects the *actual* execution order (Trick Room included), so unlike
// fp/battle/inference.py we don't need to separately detect/invert for Trick
// Room — "who moved first in the log" already accounts for it. We also don't
// replicate the synthetic single-move counterfactual foul-play builds from
// `battle.user.last_selected_move` when only the opponent acted (e.g. our
// Pokemon fainted before it could move) — that turn is simply skipped here.

import { effectiveSpeed } from './effective-speed.js';

const DISQUALIFYING_MOVES = new Set(['encore']);

function couldHaveSpeedModified(pkmn, conditions) {
    if (pkmn.ability) return false; // known, already correctly applied by effectiveSpeed
    // Any weather in play could be boosting an as-yet-unrevealed
    // Chlorophyll/Swift Swim/Sand Rush/Slush Rush — conservative on purpose.
    if (conditions.weather && conditions.weather !== 'none') return true;
    if (conditions.terrain === 'electricterrain') return true;
    if (!pkmn.item && pkmn.volatiles && pkmn.volatiles.includes('unburden')) return true;
    if (pkmn.status) return true; // could be Quick Feet
    return false;
}

// Known-only speed multiplier for a Pokemon whose *raw stat* is otherwise
// being solved for (used for the opponent side, where item/ability might
// still be unknown and are therefore excluded unless already revealed).
function knownMultiplier(pkmn, conditions) {
    return effectiveSpeed(pkmn, 1, conditions);
}

export function defaultSpeedRange() {
    return { min: 0, max: Infinity };
}

// `conditions` is { weather, terrain, trickRoom, gen, myTailwind, oppTailwind }
// — Tailwind is per-side, so it's split rather than a single shared flag.
// Returns a possibly-narrowed copy of `range`, or the same object if this
// turn's evidence doesn't apply (disqualified, or no clean 1v1 exchange).
export function narrowSpeedRange(range, turnEvents, myActive, oppActive, conditions) {
    if (
        turnEvents.anySwitchedThisTurn ||
        turnEvents.anyCant ||
        turnEvents.anyConfusionSelfHit ||
        turnEvents.anySpeedOverride
    ) {
        return range;
    }
    if (!myActive.statsExact) return range; // need our own known speed stat to compare against

    const mine = turnEvents.moves.find((m) => m.side === 'mine');
    const theirs = turnEvents.moves.find((m) => m.side === 'opponent');
    if (!mine || !theirs) return range;
    if (mine.priority !== theirs.priority) return range;
    if (DISQUALIFYING_MOVES.has(mine.moveId) || DISQUALIFYING_MOVES.has(theirs.moveId)) return range;

    const myConditions = { ...conditions, tailwind: conditions.myTailwind };
    const oppConditions = { ...conditions, tailwind: conditions.oppTailwind };
    if (couldHaveSpeedModified(myActive, myConditions) || couldHaveSpeedModified(oppActive, oppConditions))
        return range;

    const myEffSpeed = effectiveSpeed(myActive, myActive.statsExact.spe, myConditions);
    const oppMult = knownMultiplier(oppActive, oppConditions);
    if (oppMult <= 0) return range;
    const threshold = Math.floor(myEffSpeed / oppMult);

    const myWentFirst = turnEvents.moves.indexOf(mine) < turnEvents.moves.indexOf(theirs);
    if (myWentFirst) {
        return { min: range.min, max: Math.min(range.max, threshold) };
    }
    return { min: Math.max(range.min, threshold), max: range.max };
}

// Port of fp/battle/inference.py's check_choicescarf: if the opponent's
// active Pokemon went first this turn under conditions that would normally
// let us bound their speed (see speed-range.js's docstring on the same
// pre-filters), but even their best-case non-Scarf speed spread couldn't
// have gone first, they must be holding Choice Scarf.
//
// Simplification: skipped entirely under Trick Room. Choice Scarf actively
// hurts you in Trick Room (higher speed = later turn order), so foul-play's
// StandardBattleMode.assume_spread_for_speed_check picks a *slowest*-case
// spread there instead of fastest-case — inferring Scarf from "went first"
// logic doesn't apply the same way, and the payoff for handling it correctly
// is low, so it's left as a stretch item alongside Zoroark detection.

import { effectiveSpeed } from './effective-speed.js';
import { calcStat } from '../state-builder.js';
import { natureMultiplier } from '../predict/natures.js';

const DISQUALIFYING_MOVES = new Set(['encore']);

function maxSpeedSpreadStat(baseStats, level) {
    return calcStat(baseStats.spe, level, false, 31, 252, natureMultiplier('jolly', 'spe'));
}

// Returns { item: 'choicescarf', itemInferred: true } if this turn proves
// Choice Scarf, else null.
export function inferChoiceScarf(turnEvents, myActive, oppActive, conditions) {
    if (!conditions.gen.choiceScarfExists) return null;
    if (conditions.trickRoom) return null;
    if (oppActive.item) return null; // already known — nothing to infer
    if (turnEvents.anySwitchedThisTurn || turnEvents.anyCant || turnEvents.anyConfusionSelfHit || turnEvents.anySpeedOverride) {
        return null;
    }
    if (!myActive.statsExact) return null;

    const mine = turnEvents.moves.find((m) => m.side === 'mine');
    const theirs = turnEvents.moves.find((m) => m.side === 'opponent');
    if (!mine || !theirs) return null;
    if (mine.priority !== theirs.priority) return null;
    if (DISQUALIFYING_MOVES.has(mine.moveId) || DISQUALIFYING_MOVES.has(theirs.moveId)) return null;

    const oppWentFirst = turnEvents.moves.indexOf(theirs) < turnEvents.moves.indexOf(mine);
    if (!oppWentFirst) return null; // can't disprove Scarf from us going first

    const myConditions = { ...conditions, tailwind: conditions.myTailwind };
    const oppConditions = { ...conditions, tailwind: conditions.oppTailwind };
    const myEffSpeed = effectiveSpeed(myActive, myActive.statsExact.spe, myConditions);
    const bestCaseStat = maxSpeedSpreadStat(oppActive.baseStats, oppActive.level);
    const bestCaseEffSpeed = effectiveSpeed({ ...oppActive, item: null }, bestCaseStat, oppConditions);

    if (bestCaseEffSpeed < myEffSpeed) {
        return { item: 'choicescarf', itemInferred: true };
    }
    return null;
}

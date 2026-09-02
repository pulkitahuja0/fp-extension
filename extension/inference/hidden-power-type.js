// Port of fp/battle/inference.py's check_opponent_hiddenpower: prunes a
// per-Pokemon set of possible Hidden Power types based on whether a Hidden
// Power hit was resisted/neutral/super-effective against a known-typed
// target (log-events.js already resolves the resisted/neutral/
// super-effective/immune marker onto the move entry).

import {
    possibleHiddenPowerTypes,
    isNotVeryEffective,
    isSuperEffective,
    isNeutralEffectiveness,
} from './type-chart.js';

export function defaultHiddenPowerPossibilities() {
    return new Set(possibleHiddenPowerTypes());
}

// `defenderTypes` is the known [type1, type2] of whatever the opponent's
// Hidden Power hit this turn (our side, always fully known). Returns a
// possibly-narrowed copy of `possibilities`, or the same set if this turn's
// moves don't include an opponent Hidden Power use we can read effectiveness
// from.
export function narrowHiddenPowerType(possibilities, turnEvents, defenderTypesByIdent) {
    const hpMove = turnEvents.moves.find(
        (m) => m.side === 'opponent' && m.moveId.startsWith('hiddenpower') && m.effectiveness
    );
    if (!hpMove) return possibilities;
    const defenderTypes = defenderTypesByIdent[hpMove.targetIdent];
    if (!defenderTypes) return possibilities;

    let test;
    if (hpMove.effectiveness === 'resisted') test = (t) => isNotVeryEffective(t, defenderTypes);
    else if (hpMove.effectiveness === 'supereffective') test = (t) => isSuperEffective(t, defenderTypes);
    else if (hpMove.effectiveness === 'neutral') test = (t) => isNeutralEffectiveness(t, defenderTypes);
    else return possibilities; // 'immune' — Hidden Power is never Normal, so this shouldn't prune anything meaningful

    const narrowed = new Set();
    for (const type of possibilities) {
        if (test(type)) narrowed.add(type);
    }
    return narrowed.size ? narrowed : possibilities; // never fully empty the set on a fluke/edge case
}

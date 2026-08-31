// Orchestrates extension/inference/*.js over a battle snapshot: replays the
// raw protocol log (log-events.js) and applies each narrowing algorithm,
// producing per-opponent-Pokemon inference results (keyed by protocol
// ident, e.g. "p2a: Ferrothorn") that extension/predict/worlds.js applies as
// hard filters during set sampling — the JS equivalent of foul-play's
// Pokemon.impossible_items/impossible_abilities/speed_range/etc. fields.
//
// Two different reliability tiers, since this extension only has the
// *current* snapshot each time the popup runs (not foul-play's continuously
// maintained live state):
//  - Event-only signals (Heavy Duty Boots switch-in triggers, switch-in
//    ability/item reveals, Hidden Power type narrowing off our own —
//    always-known — typing) are discrete facts that stay true regardless of
//    anything that changed since, so these scan the *entire* battle log.
//  - State-dependent signals (speed-range narrowing, Choice Scarf inference)
//    need an accurate position (boosts, weather, who's active) to reason
//    about, which we only reliably have for *right now* — so these only run
//    against the most recent turn, using the current snapshot as that
//    turn's position. This undercounts evidence a live bot would have
//    accumulated over the whole battle, but avoids needing full historical
//    state reconstruction (out of scope — see log-events.js's docstring).

import { parseBattleLog } from './log-events.js';
import { narrowSpeedRange, defaultSpeedRange } from './speed-range.js';
import { inferChoiceScarf } from './choice-scarf.js';
import { narrowHiddenPowerType, defaultHiddenPowerPossibilities } from './hidden-power-type.js';
import { checkHeavyDutyBoots } from './heavy-duty-boots.js';
import { switchInImpossibilities } from './switch-in-reveal.js';

function emptyResult() {
    return {
        speedRange: defaultSpeedRange(),
        hiddenPowerPossibilities: defaultHiddenPowerPossibilities(),
        impossibleItems: new Set(),
        impossibleAbilities: new Set(),
        inferredItem: null,
    };
}

function findByIdent(side, ident) {
    return (side.pokemon || []).find((p) => p && p.ident === ident) || null;
}

// `snapshot` is page-bridge.js's shape (needs `stepQueue`/`mySideId`
// added there); `genMechanics` is a extension/predict/generations.js row for
// this battle's generation. Returns { byIdent: Map<ident, result>, lastTurnEvents }.
export function runInference(snapshot, genMechanics) {
    const turns = parseBattleLog(snapshot.stepQueue, { moveMeta: snapshot.moveMeta, mySide: snapshot.mySideId });
    const byIdent = new Map();
    const getResult = (ident) => {
        if (!byIdent.has(ident)) byIdent.set(ident, emptyResult());
        return byIdent.get(ident);
    };

    // Event-only signals: safe across the whole log.
    for (const turn of turns) {
        for (const s of turn.switches) {
            if (s.side !== 'opponent') continue;
            const pkmn = findByIdent(snapshot.oppSide, s.pokemonIdent);
            if (!pkmn) continue;
            const result = getResult(s.pokemonIdent);

            const hdb = checkHeavyDutyBoots(turn, pkmn, snapshot.oppSide.sideConditions, genMechanics);
            if (hdb) {
                if (hdb.infer) result.inferredItem = result.inferredItem || 'heavydutyboots';
                if (hdb.impossible) result.impossibleItems.add('heavydutyboots');
            }

            const reveal = switchInImpossibilities(turn, pkmn, s.pokemonIdent);
            reveal.impossibleAbilities.forEach((a) => result.impossibleAbilities.add(a));
            reveal.impossibleItems.forEach((i) => result.impossibleItems.add(i));
        }

        for (const move of turn.moves) {
            if (move.side !== 'opponent' || !move.moveId.startsWith('hiddenpower')) continue;
            const result = getResult(move.pokemonIdent);
            const defenderTypesByIdent = {};
            if (move.targetIdent) {
                const defender = findByIdent(snapshot.mySide, move.targetIdent) || findByIdent(snapshot.oppSide, move.targetIdent);
                if (defender) defenderTypesByIdent[move.targetIdent] = defender.types;
            }
            result.hiddenPowerPossibilities = narrowHiddenPowerType(result.hiddenPowerPossibilities, turn, defenderTypesByIdent);
        }
    }

    // State-dependent signals: only the most recent turn, against current state.
    const lastTurn = turns.length ? turns[turns.length - 1] : null;
    if (lastTurn) {
        const myActive = snapshot.mySide.pokemon[snapshot.mySide.activeIndex];
        const oppActive = snapshot.oppSide.pokemon[snapshot.oppSide.activeIndex];
        if (myActive && oppActive && oppActive.ident) {
            const result = getResult(oppActive.ident);
            const conditions = {
                weather: snapshot.weather,
                terrain: snapshot.terrain,
                trickRoom: snapshot.trickRoom,
                gen: genMechanics,
                myTailwind: !!snapshot.mySide.sideConditions.tailwind,
                oppTailwind: !!snapshot.oppSide.sideConditions.tailwind,
            };
            result.speedRange = narrowSpeedRange(result.speedRange, lastTurn, myActive, oppActive, conditions);
            const scarf = inferChoiceScarf(lastTurn, myActive, oppActive, conditions);
            if (scarf) result.inferredItem = result.inferredItem || scarf.item;
        }
    }

    return { byIdent, lastTurnEvents: lastTurn };
}

// Applies a runInference() result onto the actual snapshot Pokemon objects
// (by ident), so extension/predict/worlds.js's sampler can read plain
// fields off each opponent Pokemon rather than re-joining against the Map.
export function applyInference(oppSide, inference) {
    for (const pkmn of oppSide.pokemon) {
        if (!pkmn || !pkmn.ident) continue;
        const result = inference.byIdent.get(pkmn.ident);
        if (!result) continue;
        pkmn.speedRange = result.speedRange;
        pkmn.hiddenPowerPossibilities = result.hiddenPowerPossibilities;
        pkmn.impossibleItems = result.impossibleItems;
        pkmn.impossibleAbilities = result.impossibleAbilities;
        if (result.inferredItem && !pkmn.item) {
            pkmn.item = result.inferredItem;
            pkmn.itemInferred = true;
        }
    }
}

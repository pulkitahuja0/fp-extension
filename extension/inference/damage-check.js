// Port of fp/battle/inference.py's update_dataset_possibilities/_do_check:
// for a hypothesized opponent set, recompute what damage a known move would
// have dealt using poke-engine's own damage calculator (rs-wasm/src/lib.rs's
// damage_rolls export), and eliminate the hypothesis if it doesn't explain
// what was actually observed.
//
// Simplification vs foul-play: it maintains a live, continuously-updated
// Battle object, so it can replay this check against the exact historical
// position right after each damage event, going back over the whole battle.
// This extension only has the *current* snapshot each time the popup runs,
// so it only checks the most recent turn's damage events, using the current
// snapshot's weather/terrain/boosts as a stand-in for "the state at that
// time" (valid since nothing else has changed since that turn resolved).
// Older turns' damage evidence is not re-checked.

import { buildState } from '../state-builder.js';
import { damageRolls } from '../wasm-loader.js';

const TOLERANCE = 0.025; // ±2.5%, matching foul-play's _do_check
const ROLL_WINDOW = 0.85; // PS's 16-value damage roll spans 85%-100% of the max roll

// A handful of moves foul-play also excludes from reverse-damage-calc:
// multi-hit/variable-power moves whose single-hit damage isn't a clean
// function of the attacker's stats alone.
const EXCLUDED_MOVES = new Set([
    'pursuit', 'struggle', 'counter', 'mirrorcoat', 'metalburst', 'foulplay',
    'meteorbeam', 'electroshot', 'ficklebeam', 'lashout', 'ragefist', 'shellsidearm', 'futuresight',
]);

function isCheckable(damageEvent) {
    if (!damageEvent.move || damageEvent.move.missed || damageEvent.action !== '-damage') return false;
    if (damageEvent.crit) return false; // crit rolls fall outside the normal roll window
    if (EXCLUDED_MOVES.has(damageEvent.move.moveId)) return false;
    if (damageEvent.move.moveId.startsWith('hiddenpower')) return false; // handled by hidden-power-type.js instead
    if (damageEvent.hp === damageEvent.maxhp) return false; // no net damage this instant
    return true;
}

// `snapshot` is the full current battle snapshot; `candidateOppPkmn` is the
// opponent Pokemon snapshot object with a hypothesized ability/item/nature/
// evs already applied (see extension/predict/worlds.js). `damageEvent` is
// one entry from log-events.js's most-recent-turn damageEvents. Returns true
// if the candidate survives (damage roll window contains the observed
// value, within tolerance), false if this evidence rules it out.
export async function candidateSurvivesDamageCheck(snapshot, candidateOppPkmn, damageEvent, formatId) {
    if (!isCheckable(damageEvent)) return true;

    const attackerSide = damageEvent.move.side; // 'mine' | 'opponent'
    const observedDamage = damageEvent.maxhp - damageEvent.hp;
    const nearKO = damageEvent.fainted || damageEvent.hp / damageEvent.maxhp < 0.02;

    const oppSide = { ...snapshot.oppSide, pokemon: snapshot.oppSide.pokemon.slice() };
    oppSide.pokemon[oppSide.activeIndex] = candidateOppPkmn;
    const hypothetical = { ...snapshot, oppSide };

    let stateStr;
    try {
        stateStr = buildState(hypothetical);
    } catch (e) {
        return true; // malformed hypothesis — don't let a plumbing error prune a candidate
    }

    const sideOneAttacks = attackerSide === 'mine';
    const sideOneMove = sideOneAttacks ? `move:${damageEvent.move.moveId}` : 'switch';
    const sideTwoMove = sideOneAttacks ? 'switch' : `move:${damageEvent.move.moveId}`;

    let result;
    try {
        result = await damageRolls(formatId, stateStr, sideOneMove, sideTwoMove, sideOneAttacks);
    } catch (e) {
        return true;
    }
    const rolls = sideOneAttacks ? result.side_one : result.side_two;
    if (!rolls || !rolls.length) return true;

    const maxRoll = Math.max(...rolls);
    const windowMax = maxRoll * (1 + TOLERANCE);
    const windowMin = maxRoll * ROLL_WINDOW * (1 - TOLERANCE);

    if (observedDamage > windowMax) return false;
    if (!nearKO && observedDamage < windowMin) return false;
    return true;
}

// Runs candidateSurvivesDamageCheck against every checkable damage event
// from the most recent turn, for both directions (opponent hit us, or we hit
// the opponent) — a candidate must survive all of them.
export async function candidateSurvivesRecentDamage(snapshot, candidateOppPkmn, recentTurnEvents, formatId) {
    if (!recentTurnEvents) return true;
    for (const event of recentTurnEvents.damageEvents) {
        if (!isCheckable(event)) continue;
        const survives = await candidateSurvivesDamageCheck(snapshot, candidateOppPkmn, event, formatId);
        if (!survives) return false;
    }
    return true;
}

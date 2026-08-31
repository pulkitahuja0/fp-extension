// Port of fp/battle/inference.py's check_heavydutyboots: when the opponent
// switches into a hazard they're susceptible to, Heavy Duty Boots is either
// confirmed (the hazard's usual damage/status/speed-drop didn't fire) or
// ruled out (it did).

const HAZARD_SUSCEPTIBLE = {
    stealthrock: () => true, // Stealth Rock ignores typing/grounding — always checked
    spikes: (pkmn) => !pkmn.types.includes('FLYING') && pkmn.ability !== 'levitate',
    toxicspikes: (pkmn) =>
        !pkmn.types.includes('FLYING') &&
        !pkmn.types.includes('POISON') &&
        !pkmn.types.includes('STEEL') &&
        !pkmn.status &&
        pkmn.ability !== 'levitate' &&
        pkmn.ability !== 'immunity',
    stickyweb: (pkmn) => !pkmn.types.includes('FLYING') && pkmn.ability !== 'levitate',
};

// Returns { infer: true } | { impossible: true } | null for this turn's
// evidence about the opponent's newly-switched-in Pokemon, per hazard.
// `sideConditions` is the opponent's current side-condition snapshot
// (extension/page-bridge.js's shape: spikes/toxicSpikes are levels, others
// are 0/1 presence flags).
export function checkHeavyDutyBoots(turnEvents, oppActive, sideConditions, gen) {
    if (!gen.heavyDutyBootsExists) return null;
    if (oppActive.item) return null;
    if (oppActive.ability === 'magicguard') return null;

    const switchedIn = turnEvents.switches.some((s) => s.side === 'opponent');
    if (!switchedIn) return null;

    const activeHazards = [];
    if (sideConditions.stealthrock) activeHazards.push('stealthrock');
    if (sideConditions.spikes) activeHazards.push('spikes');
    if (sideConditions.toxicSpikes) activeHazards.push('toxicspikes');
    if (sideConditions.stickyweb) activeHazards.push('stickyweb');

    for (const hazard of activeHazards) {
        if (!HAZARD_SUSCEPTIBLE[hazard](oppActive)) continue;
        const triggered = turnEvents.hazardEvents.some((e) => e.side === 'opponent' && e.hazard === hazard && e.triggered);
        return triggered ? { impossible: true } : { infer: true };
    }
    return null;
}

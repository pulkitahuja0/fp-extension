// Port of fp/battle/state.py's Battle.get_effective_speed: the fully
// speed-boosted value of an active Pokemon, accounting for boost stage,
// weather/terrain-boosting abilities, Unburden, Quick Feet, Tailwind,
// Choice Scarf, paralysis, and the Protosynthesis/Quark Drive speed boost —
// everything extension/inference/speed-range.js and choice-scarf.js need to
// turn a raw stat into a comparable in-battle speed value.

const WEATHER_SPEED_ABILITIES = {
    sunnyday: 'chlorophyll',
    raindance: 'swiftswim',
    sandstorm: 'sandrush',
    hail: 'slushrush',
    snow: 'slushrush',
};

function boostMultiplier(stage) {
    if (!stage) return 1;
    return stage > 0 ? (2 + stage) / 2 : 2 / (2 - stage);
}

// `pokemon` is a snapshot Pokemon (extension/page-bridge.js's shape): needs
// .ability, .item, .status, .boosts.spe, .volatiles, and a `.speed` raw stat
// (callers pass either the known/predicted stat or a hypothesized one).
// `battleConditions` is { weather, terrain, tailwind (bool, this side's own
// Tailwind), gen (GenerationMechanics) }.
export function effectiveSpeed(pokemon, speed, battleConditions) {
    let s = speed * boostMultiplier(pokemon.boosts ? pokemon.boosts.spe : 0);

    const ability = pokemon.ability;
    if (WEATHER_SPEED_ABILITIES[battleConditions.weather] === ability) s *= 2;
    if (ability === 'surgesurfer' && battleConditions.terrain === 'electricterrain') s *= 2;

    const volatiles = pokemon.volatiles || [];
    if (ability === 'unburden' && volatiles.includes('unburden')) s *= 2;

    const hasQuickFeet = ability === 'quickfeet' && !!pokemon.status;
    if (hasQuickFeet) s *= 1.5;

    if (battleConditions.tailwind) s *= 2;
    if (pokemon.item === 'choicescarf') s *= 1.5;

    if (pokemon.status === 'par' && !hasQuickFeet) {
        s *= 1 / battleConditions.gen.paralysisSpeedDivisor;
    }

    if (volatiles.includes('protosynthesisspe') || volatiles.includes('quarkdrivespe')) s *= 1.5;

    return Math.floor(s);
}

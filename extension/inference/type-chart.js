// Port of fp/battle/helpers.py's DAMAGE_MULTIPICATION_ARRAY + type_effectiveness_modifier
// (the modern, gen6+ type chart). Only used by hidden-power-type.js to
// classify a hit as resisted/neutral/super-effective — the pre-gen6
// Steel-doesn't-resist-Dark/Ghost and gen1 chart quirks apply to damage
// calculation generally, not specifically to this narrow use, and aren't
// replicated here (foul-play applies them via apply_mods.py's data patching,
// out of scope per this repo's plan).

const CHART = {
    normal: { rock: 0.5, ghost: 0, steel: 0.5 },
    fire: { fire: 0.5, water: 0.5, grass: 2, ice: 2, bug: 2, rock: 0.5, dragon: 0.5, steel: 2 },
    water: { fire: 2, water: 0.5, grass: 0.5, ground: 2, rock: 2, dragon: 0.5 },
    electric: { water: 2, electric: 0.5, grass: 0.5, ground: 0, flying: 2, dragon: 0.5 },
    grass: { fire: 0.5, water: 2, grass: 0.5, poison: 0.5, ground: 2, flying: 0.5, bug: 0.5, rock: 2, dragon: 0.5, steel: 0.5 },
    ice: { fire: 0.5, water: 0.5, grass: 2, ice: 0.5, ground: 2, flying: 2, dragon: 2, steel: 0.5 },
    fighting: { normal: 2, ice: 2, poison: 0.5, flying: 0.5, psychic: 0.5, bug: 0.5, rock: 2, ghost: 0, dark: 2, steel: 2, fairy: 0.5 },
    poison: { grass: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5, steel: 0, fairy: 2 },
    ground: { fire: 2, electric: 2, grass: 0.5, poison: 2, flying: 0, bug: 0.5, rock: 2, steel: 2 },
    flying: { electric: 0.5, grass: 2, fighting: 2, bug: 2, rock: 0.5, steel: 0.5 },
    psychic: { fighting: 2, poison: 2, psychic: 0.5, dark: 0, steel: 0.5 },
    bug: { fire: 0.5, grass: 2, fighting: 0.5, poison: 0.5, flying: 0.5, psychic: 2, ghost: 0.5, dark: 2, steel: 0.5, fairy: 0.5 },
    rock: { fire: 2, ice: 2, fighting: 0.5, ground: 0.5, flying: 2, bug: 2, steel: 0.5 },
    ghost: { normal: 0, psychic: 2, ghost: 2, dark: 0.5 },
    dragon: { dragon: 2, steel: 0.5, fairy: 0 },
    dark: { fighting: 0.5, psychic: 2, ghost: 2, dark: 0.5, fairy: 0.5 },
    steel: { fire: 0.5, water: 0.5, electric: 0.5, ice: 2, rock: 2, steel: 0.5, fairy: 2 },
    fairy: { fire: 0.5, fighting: 2, poison: 0.5, dragon: 2, dark: 2, steel: 0.5 },
};

// `attackType`/`defendTypes` are lowercase type ids (e.g. 'fire'); a
// TYPELESS second type contributes no multiplier.
export function typeEffectiveness(attackType, defendTypes) {
    const table = CHART[attackType] || {};
    let mult = 1;
    for (const t of defendTypes) {
        const id = (t || '').toLowerCase();
        if (id && id !== 'typeless' && table[id] !== undefined) mult *= table[id];
    }
    return mult;
}

export function isSuperEffective(attackType, defendTypes) {
    return typeEffectiveness(attackType, defendTypes) > 1;
}

export function isNotVeryEffective(attackType, defendTypes) {
    const m = typeEffectiveness(attackType, defendTypes);
    return m > 0 && m < 1;
}

export function isNeutralEffectiveness(attackType, defendTypes) {
    return typeEffectiveness(attackType, defendTypes) === 1;
}

// All types Hidden Power can be: everything except Normal (its own
// "typeless" damage type) and Fairy (added after Hidden Power's move pool
// was fixed, never assigned to it).
export function possibleHiddenPowerTypes() {
    return Object.keys(CHART).filter((t) => t !== 'normal' && t !== 'fairy');
}

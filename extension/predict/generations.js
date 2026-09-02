// Per-generation behavioral flags the inference (extension/inference/*.js) and
// sampling (extension/predict/*.js) layers need. Port of the subset of
// foul-play's fp/generations.py (GenerationMechanics) that standard-tiers
// analysis actually reads — not a full port of that file's dataclass-chain
// (Champions/BSS-specific fields, PP-formula callables, etc. are out of scope
// per this repo's plan, since only standard tiers are supported).
//
// foul-play builds these via `dataclasses.replace()` down a gen9->gen1 chain
// ("gen N differs from gen N+1 by exactly these fields"); that's a Python
// ergonomics pattern for avoiding repetition, not something worth mirroring
// in JS — these are just flat per-gen objects instead.

const GENERATIONS = {
    9: {
        choiceScarfExists: true,
        heavyDutyBootsExists: true,
        megasExist: false,
        supportsReverseDamageChecking: true,
        paralysisSpeedDivisor: 2,
        hiddenPowerBaseDamage: 60,
        maxEv: 252,
        statCalculation: 'modern',
    },
    8: {
        choiceScarfExists: true,
        heavyDutyBootsExists: true,
        megasExist: false,
        supportsReverseDamageChecking: true,
        paralysisSpeedDivisor: 2,
        hiddenPowerBaseDamage: 60,
        maxEv: 252,
        statCalculation: 'modern',
    },
    7: {
        choiceScarfExists: true,
        heavyDutyBootsExists: false,
        megasExist: true,
        supportsReverseDamageChecking: true,
        paralysisSpeedDivisor: 2,
        hiddenPowerBaseDamage: 60,
        maxEv: 252,
        statCalculation: 'modern',
    },
    6: {
        choiceScarfExists: true,
        heavyDutyBootsExists: false,
        megasExist: true,
        supportsReverseDamageChecking: true,
        paralysisSpeedDivisor: 4,
        hiddenPowerBaseDamage: 60,
        maxEv: 252,
        statCalculation: 'modern',
    },
    5: {
        choiceScarfExists: true,
        heavyDutyBootsExists: false,
        megasExist: false,
        supportsReverseDamageChecking: true,
        paralysisSpeedDivisor: 4,
        hiddenPowerBaseDamage: 70,
        maxEv: 252,
        statCalculation: 'modern',
    },
    4: {
        choiceScarfExists: true,
        heavyDutyBootsExists: false,
        megasExist: false,
        supportsReverseDamageChecking: true,
        paralysisSpeedDivisor: 4,
        hiddenPowerBaseDamage: 70,
        maxEv: 252,
        statCalculation: 'modern',
    },
    3: {
        choiceScarfExists: false,
        heavyDutyBootsExists: false,
        megasExist: false,
        supportsReverseDamageChecking: true,
        paralysisSpeedDivisor: 4,
        hiddenPowerBaseDamage: 70,
        maxEv: 252,
        statCalculation: 'modern',
    },
    2: {
        choiceScarfExists: false,
        heavyDutyBootsExists: false,
        megasExist: false,
        supportsReverseDamageChecking: false,
        paralysisSpeedDivisor: 4,
        hiddenPowerBaseDamage: 70,
        maxEv: 252,
        statCalculation: 'gen1_2',
    },
    1: {
        choiceScarfExists: false,
        heavyDutyBootsExists: false,
        megasExist: false,
        supportsReverseDamageChecking: false,
        paralysisSpeedDivisor: 4,
        hiddenPowerBaseDamage: 70,
        maxEv: 252,
        statCalculation: 'gen1_2',
    },
};

export function generationMechanics(genNumber) {
    const mechanics = GENERATIONS[genNumber];
    if (!mechanics) throw new Error(`Unsupported generation: ${genNumber}`);
    return mechanics;
}

// Parses the leading "genN" out of a Pokemon Showdown format id, e.g.
// "gen9ou" -> 9. Mirrors the gen-number half of fp/format_spec.py's
// FormatSpec (the battle-type/champions/blitz/national-dex fields aren't
// needed here since only standard tiers are in scope).
export function genNumberFromFormat(formatId) {
    const match = /^gen(\d)/.exec(formatId);
    if (!match) throw new Error(`Could not determine generation from format id: ${formatId}`);
    return Number(match[1]);
}

// Port of fp/format_spec.py's `"random" in format_string` battle-type check:
// random battle formats (gen9randombattle, gen9randomdoublesbattle, ...) get
// their opponent's team from Pokemon Showdown's own fixed per-species set
// pool, not from Smogon usage stats or observed teams — see
// extension/predict/randbats.js and extension/predict/random-worlds.js.
export function isRandomBattleFormat(formatId) {
    return formatId.includes('random');
}

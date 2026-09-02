// Converts a battle snapshot (produced by page-bridge.js from the live PS
// client) into poke-engine's pipe-delimited `State::deserialize` wire
// format. Deliberately has no dependency on the PS client or the DOM, so the
// format logic can be read/tested on its own; see
// rs-wasm/vendor/poke-engine/src/state.rs for the format this mirrors
// (State::deserialize's doc comment spells out every field in order).
//
// Known simplifications, all a consequence of imperfect information about
// the opponent's team (nature/EVs/IVs are never revealed to an opponent):
//  - Unrevealed opponent stats use a predicted nature/EV spread when
//    predict/predictor.js supplied one (`p.predictedNature`/`p.predictedEvs`,
//    set by popup.js before buildState() runs), else fall back to a neutral
//    nature, 31 IVs, and 85 EVs in every stat (poke-engine's own DEFAULT_EVS).
//  - Unrevealed opponent moves/ability/item likewise use the predictor's
//    best guess when available, else are left blank (engine treats blank
//    moves as unusable) / default to "none".
//  - Side conditions that are inherently single-turn (Protect, Quick Guard,
//    Wide Guard, Crafty Shield, Mat Block) and one-shot heals (Wish,
//    Healing Wish, Lunar Dance) are not tracked.
//  - rest_turns/sleep_turns default to 0 unless the client happens to know
//    the exact sleep-turn count for our own side.

import { natureMultiplier } from './predict/natures.js';

const WEATHER_MAP = {
    '': 'none',
    sunnyday: 'sun',
    raindance: 'rain',
    sandstorm: 'sand',
    hail: 'hail',
    snow: 'snow',
    desolateland: 'harshsun',
    primordialsea: 'heavyrain',
};

const STATUS_MAP = {
    '': 'none',
    brn: 'burn',
    slp: 'sleep',
    frz: 'freeze',
    par: 'paralyze',
    psn: 'poison',
    tox: 'toxic',
};

// Exported for extension/inference/choice-scarf.js, which needs the same
// modern (gen3+) stat formula to evaluate a hypothesized speed spread —
// Choice Scarf doesn't exist before gen4, so it never needs the gen1/2
// formula branch estimateStats() below picks between.
export function calcStat(base, level, isHP, iv, ev, natureMod) {
    if (isHP) {
        if (base === 1) return 1; // Shedinja
        return Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100) + level + 10;
    }
    const flat = Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100) + 5;
    return Math.floor(flat * natureMod);
}

function estimateStats(baseStats, level, nature, evs) {
    const iv = 31;
    const defaultEv = 85; // matches poke-engine's own DEFAULT_EVS assumption for unknown spreads
    const evOf = (i) => (evs ? evs[i] : defaultEv);
    const natureMod = (stat) => (nature ? natureMultiplier(nature, stat) : 1);
    return {
        hp: calcStat(baseStats.hp, level, true, iv, evOf(0), 1),
        atk: calcStat(baseStats.atk, level, false, iv, evOf(1), natureMod('atk')),
        def: calcStat(baseStats.def, level, false, iv, evOf(2), natureMod('def')),
        spa: calcStat(baseStats.spa, level, false, iv, evOf(3), natureMod('spa')),
        spd: calcStat(baseStats.spd, level, false, iv, evOf(4), natureMod('spd')),
        spe: calcStat(baseStats.spe, level, false, iv, evOf(5), natureMod('spe')),
    };
}

function engineMoveId(psId, gen) {
    if (!psId) return 'NONE';
    if (psId.startsWith('hiddenpower') && psId.length > 'hiddenpower'.length) {
        const type = psId.slice('hiddenpower'.length);
        const bp = gen <= 5 ? 70 : 60;
        return `HIDDENPOWER${type.toUpperCase()}${bp}`;
    }
    return psId.toUpperCase();
}

function serializeMove(move, gen) {
    const id = engineMoveId(move ? move.id : '', gen);
    if (id === 'NONE') return 'NONE;false;32';
    const disabled = move.disabled ? 'true' : 'false';
    const pp = typeof move.pp === 'number' ? Math.max(0, Math.floor(move.pp)) : 32;
    return `${id};${disabled};${pp}`;
}

// hp=0 (fainted) is deliberate: poke-engine's add_switches() only offers a
// switch to a Pokemon with hp > 0, so a live/hp=100 placeholder here would
// make the engine treat "switch to an empty roster slot" as a real option —
// it would still stringify as a real-looking (if blank) choice, since every
// empty slot shares the same NONE species name, so several of these ghost
// options collapse into one indistinguishable, artificially-inflated choice
// once anything (e.g. extension/predict/aggregate.js) sums option weights by
// their string label across searches.
const EMPTY_POKEMON =
    'NONE,100,NORMAL,TYPELESS,NORMAL,TYPELESS,0,100,NONE,NONE,NONE,SERIOUS,,100,100,100,100,100,NONE,0,0,1,' +
    'NONE;false;32,NONE;false;32,NONE;false;32,NONE;false;32,false,false,NORMAL';

function serializePokemon(p, gen) {
    if (!p) return EMPTY_POKEMON;

    let hp = p.hp;
    let maxhp = p.maxhp;
    if (p.hpPercent !== null && p.hpPercent !== undefined) {
        const est = estimateStats(p.baseStats, p.level, p.predictedNature, p.predictedEvs);
        maxhp = est.hp;
        hp = Math.max(0, Math.round((p.hpPercent / 100) * maxhp));
    }
    if (p.fainted) hp = 0;

    const stats = p.statsExact || estimateStats(p.baseStats, p.level, p.predictedNature, p.predictedEvs);

    const ability = p.ability ? p.ability.toUpperCase() : 'NONE';
    const item = p.item ? p.item.toUpperCase() : 'NONE';
    const status = STATUS_MAP[p.status] ? STATUS_MAP[p.status].toUpperCase() : 'NONE';
    const teraType = p.teraType || 'NORMAL';

    const moves = p.moves.slice(0, 4).map((m) => serializeMove(m, gen));
    while (moves.length < 4) moves.push('NONE;false;32');

    return [
        p.species.toUpperCase(),
        p.level,
        p.types[0],
        p.types[1],
        p.baseTypes[0],
        p.baseTypes[1],
        hp,
        maxhp,
        ability,
        ability, // base_ability: we don't track pre-transform ability separately
        item,
        'SERIOUS', // nature: unknown for the opponent, irrelevant once stats are given directly
        '', // evs: unused since final stats are supplied explicitly below
        stats.atk,
        stats.def,
        stats.spa,
        stats.spd,
        stats.spe,
        status,
        0, // rest_turns: not tracked (see module docs)
        p.sleepTurns || 0,
        p.weightkg,
        moves[0],
        moves[1],
        moves[2],
        moves[3],
        p.megaEvolved ? 'true' : 'false',
        p.terastallized ? 'true' : 'false',
        teraType,
    ].join(',');
}

const SIDE_CONDITION_ORDER = [
    'auroraveil',
    'craftyshield',
    'healingwish',
    'lightscreen',
    'luckychant',
    'lunardance',
    'matblock',
    'mist',
    'protect',
    'quickguard',
    'reflect',
    'safeguard',
    'spikes',
    'stealthrock',
    'stickyweb',
    'tailwind',
    'toxiccount',
    'toxicspikes',
    'wideguard',
];

function serializeSideConditions(sc) {
    const values = {
        auroraveil: sc.auroraveil,
        craftyshield: 0,
        healingwish: 0,
        lightscreen: sc.lightscreen,
        luckychant: sc.luckychant,
        lunardance: 0,
        matblock: 0,
        mist: sc.mist,
        protect: 0,
        quickguard: 0,
        reflect: sc.reflect,
        safeguard: sc.safeguard,
        spikes: sc.spikes,
        stealthrock: sc.stealthrock,
        stickyweb: sc.stickyweb,
        tailwind: sc.tailwind,
        toxiccount: 0,
        toxicspikes: sc.toxicSpikes,
        wideguard: 0,
    };
    return SIDE_CONDITION_ORDER.map((k) => values[k] || 0).join(';');
}

function serializeSide(side, gen) {
    const pkmn = side.pokemon.slice(0, 6).map((p) => serializePokemon(p, gen));
    while (pkmn.length < 6) pkmn.push(EMPTY_POKEMON);

    const fields = [
        ...pkmn,
        side.activeIndex, // active_index
        serializeSideConditions(side.sideConditions), // side_conditions
        (side.pokemon[side.activeIndex]?.volatiles || []).map((v) => v.toUpperCase()).join(':'), // volatile_statuses
        '0;0;0;0;0;0', // volatile_status_durations: not tracked precisely
        '0', // substitute_health: not tracked precisely
        side.pokemon[side.activeIndex]?.boosts.atk || 0,
        side.pokemon[side.activeIndex]?.boosts.def || 0,
        side.pokemon[side.activeIndex]?.boosts.spa || 0,
        side.pokemon[side.activeIndex]?.boosts.spd || 0,
        side.pokemon[side.activeIndex]?.boosts.spe || 0,
        side.pokemon[side.activeIndex]?.boosts.accuracy || 0,
        side.pokemon[side.activeIndex]?.boosts.evasion || 0,
        0, // wish.0
        0, // wish.1
        0, // future_sight.0
        0, // future_sight.1
        side.forceSwitch ? 'true' : 'false',
        'NONE', // switch_out_move_second_saved_move
        'false', // baton_passing
        'false', // shed_tailing
        'false', // force_trapped
        'switch:0', // last_used_move: unknown, harmless default
        'false', // slow_uturn_move
    ];
    return fields.join('=');
}

export function buildState(snapshot) {
    const gen = snapshot.gen;
    const sideOne = serializeSide(snapshot.mySide, gen);
    const sideTwo = serializeSide(snapshot.oppSide, gen);
    const weather = `${(WEATHER_MAP[snapshot.weather] || 'none').toUpperCase()};${snapshot.weatherTurns || 0}`;
    const terrain = `${(snapshot.terrain || 'none').toUpperCase()};${snapshot.terrainTurns || 0}`;
    const trickRoom = `${snapshot.trickRoom ? 'true' : 'false'};${snapshot.trickRoomTurns || 0}`;
    // At the team-preview node, poke-engine's root_get_all_options() ignores
    // active_index entirely and instead offers a switch-choice for every
    // living roster member on each side (see
    // rs-wasm/vendor/poke-engine/src/genx/state.rs's root_get_all_options) —
    // so a search against this state naturally ranks "which Pokemon to lead
    // with" rather than a battle move.
    const teamPreview = snapshot.teamPreview ? 'true' : 'false';
    return [sideOne, sideTwo, weather, terrain, trickRoom, teamPreview].join('/');
}

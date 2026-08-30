// "Does this trait combo / moveset make competitive sense" checks, ported
// from foul-play's fp/data/sets/base.py (`_pokemon_set_makes_sense` and
// `PredictedPokemonSet.set_makes_logical_sense`). Not every case from
// base.py is here — just the ones that most often change which candidate
// set wins: Choice items, boosting moves, Life Orb/Assault Vest, Trick.
import { natureMultiplier } from './natures.js';

const MAX_EV = 252;

const CHOICE_ITEMS = new Set(['choiceband', 'choicespecs', 'choicescarf']);
const TRICKABLE_ITEMS = new Set([
    'choicespecs', 'choicescarf', 'choiceband', 'assaultvest', 'blacksludge', 'stickybarb', 'flameorb', 'toxicorb',
]);
const PIVOT_MOVES = new Set(['uturn', 'voltswitch', 'flipturn', 'nuzzle', 'selfdestruct', 'explosion', 'knockoff']);
const CHOICE_EXEMPT_MOVES = new Set(['trick', 'switcheroo', 'flipturn', 'uturn', 'voltswitch']);
const PHYSICAL_BOOST_MOVES = new Set([
    'swordsdance', 'dragondance', 'tidyup', 'sharpen', 'meditate', 'honeclaws', 'bellydrum', 'howl', 'shiftgear',
]);
const SPECIAL_BOOST_MOVES = new Set(['nastyplot', 'tailglow']);

// A pivot/priority move doesn't reveal anything about a set's offensive
// stat investment (e.g. a special attacker can run U-turn just fine).
function damagingMoveIsUtility(mv, meta) {
    if (PIVOT_MOVES.has(mv)) return true;
    return !!meta && meta.priority > 0;
}

function choiceItemLogical(item, moves, moveMeta) {
    const logicalCategory = item === 'choiceband' ? 'physical' : item === 'choicespecs' ? 'special' : null;
    let illogical = 0;
    for (const mv of moves) {
        if (CHOICE_EXEMPT_MOVES.has(mv)) continue;
        const category = moveMeta[mv] ? moveMeta[mv].category : null;
        const isLogical = logicalCategory ? category === logicalCategory : category === 'physical' || category === 'special';
        if (!isLogical) illogical++;
    }
    return illogical <= 1;
}

function boostMoveLogical(set, mv, moves, moveMeta, offensiveEvIndex, offensiveStat, otherStat) {
    if (CHOICE_ITEMS.has(set.item)) return false;
    const otherCategory = offensiveStat === 'atk' ? 'special' : 'physical';
    const nonMatchingCount = moves.filter((m) => m !== mv && moveMeta[m] && moveMeta[m].category === otherCategory).length;
    if (nonMatchingCount > 1) return false;
    if (set.evs[offensiveEvIndex] < MAX_EV / 4) return false;
    if (natureMultiplier(set.nature, otherStat) > 1 || natureMultiplier(set.nature, offensiveStat) < 1) return false;
    return true;
}

// Trait-combo only (ability/item/spread/tera) — used by smogon-sets.js's
// cross product, which has no moveset attached yet. Port of
// SmogonSets._pokemon_set_makes_sense.
export function traitComboMakesSense(set) {
    if (set.item === 'choiceband' && set.evs[1] < MAX_EV * 0.5) return false;
    if (set.item === 'choicespecs' && set.evs[3] < MAX_EV * 0.5) return false;
    if (set.item === 'choicescarf' && set.evs[5] < MAX_EV * 0.8) return false;
    if ((set.item === 'lifeorb' || set.item === 'expertbelt') && set.evs[1] < MAX_EV * 0.5 && set.evs[3] < MAX_EV * 0.5) {
        return false;
    }
    return true;
}

// Full set (trait combo + moveset) — port of
// PredictedPokemonSet.set_makes_logical_sense.
export function fullSetMakesSense(set, moves, moveMeta) {
    if (!traitComboMakesSense(set)) return false;

    switch (set.item) {
        case 'lightclay': {
            const screens = new Set(['reflect', 'lightscreen', 'auroraveil']);
            if (!moves.some((m) => screens.has(m))) return false;
            break;
        }
        case 'toxicorb':
            if (!['poisonheal', 'quickfeet', 'magicguard', 'marvelscale', 'guts', 'toxicboost'].includes(set.ability)) return false;
            break;
        case 'flameorb':
            if (!['quickfeet', 'magicguard', 'guts', 'flareboost'].includes(set.ability)) return false;
            break;
        case 'choiceband':
        case 'choicespecs':
        case 'choicescarf':
            if (!choiceItemLogical(set.item, moves, moveMeta)) return false;
            break;
        case 'lifeorb': {
            const minOffensiveEv = MAX_EV * 0.5;
            if (set.evs[1] < minOffensiveEv && set.evs[3] < minOffensiveEv) return false;
            break;
        }
        case 'assaultvest':
            if (set.ability !== 'klutz' && moves.some((m) => moveMeta[m] && moveMeta[m].category === 'status')) return false;
            break;
    }

    if (set.ability === 'poisonheal' && set.item !== 'toxicorb') return false;

    for (const mv of moves) {
        const meta = moveMeta[mv];
        if (meta && !damagingMoveIsUtility(mv, meta)) {
            if (meta.category === 'physical' && set.evs[3] > 6) return false;
            if (meta.category === 'special' && set.evs[1] > 6) return false;
        }

        if (mv === 'protect' && CHOICE_ITEMS.has(set.item)) return false;
        if (PHYSICAL_BOOST_MOVES.has(mv) && !boostMoveLogical(set, mv, moves, moveMeta, 1, 'atk', 'spa')) return false;
        if (SPECIAL_BOOST_MOVES.has(mv) && !boostMoveLogical(set, mv, moves, moveMeta, 3, 'spa', 'atk')) return false;

        if (mv === 'bulkup' || mv === 'curse') {
            if (CHOICE_ITEMS.has(set.item)) return false;
            if (set.evs[3] > 0) return false;
            if (natureMultiplier(set.nature, 'spa') > 1) return false;
        }
        if (mv === 'calmmind') {
            if (CHOICE_ITEMS.has(set.item)) return false;
            if (set.evs[1] > 0) return false;
            if (natureMultiplier(set.nature, 'atk') > 1) return false;
        }
        if ((mv === 'trick' || mv === 'switcheroo') && !TRICKABLE_ITEMS.has(set.item)) return false;

        if (mv === 'batonpass') {
            const hasSelfBoost = moves.some((m) => moveMeta[m] && moveMeta[m].hasBoosts && moveMeta[m].targetsSelf);
            if (!hasSelfBoost) return false;
        }
    }

    return true;
}

// Port of the switch-in negative-inference channel from fp/battle/protocol.py's
// switch_or_drag: certain abilities/items always show themselves immediately
// on switch-in if the Pokemon has them (Intimidate's stat drop, Pressure's
// PP-usage tell, a weather-setter's weather change, Booster Energy's boost,
// Air Balloon's "grounded" tag). If a Pokemon switches in and none of these
// fire, they're all impossible — a cheap, high-value negative-inference
// signal foul-play's ABILITIES_REVEALED_ON_SWITCH_IN / ITEMS_REVEALED_ON_SWITCH_IN
// constants capture.

const ABILITIES_REVEALED_ON_SWITCH_IN = [
    'intimidate', 'pressure', 'neutralizinggas', 'sandstream', 'drought', 'drizzle', 'snowwarning',
];
const ITEMS_REVEALED_ON_SWITCH_IN = ['boosterenergy', 'airballoon'];

// Returns { impossibleAbilities: string[], impossibleItems: string[] } for
// whichever of the reveal-on-switch-in list did *not* fire this turn for the
// opponent's newly-switched-in Pokemon. Empty arrays if the Pokemon didn't
// switch in this turn, or its ability/item is already known.
export function switchInImpossibilities(turnEvents, oppActive, oppIdent) {
    const result = { impossibleAbilities: [], impossibleItems: [] };
    const switchedIn = turnEvents.switches.some((s) => s.side === 'opponent' && s.pokemonIdent === oppIdent);
    if (!switchedIn) return result;

    if (!oppActive.ability) {
        const revealed = new Set(
            turnEvents.abilityReveals.filter((r) => r.side === 'opponent' && r.ident === oppIdent).map((r) => r.ability)
        );
        for (const ability of ABILITIES_REVEALED_ON_SWITCH_IN) {
            if (!revealed.has(ability)) result.impossibleAbilities.push(ability);
        }
    }

    if (!oppActive.item) {
        const revealed = new Set(
            turnEvents.itemReveals.filter((r) => r.side === 'opponent' && r.ident === oppIdent).map((r) => r.item)
        );
        for (const item of ITEMS_REVEALED_ON_SWITCH_IN) {
            if (!revealed.has(item)) result.impossibleItems.push(item);
        }
    }

    return result;
}

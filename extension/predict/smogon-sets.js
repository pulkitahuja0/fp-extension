// Port of foul-play's fp/data/sets/smogon.py (SmogonSets): downloads
// Smogon's monthly usage-stats "chaos" JSON and turns each Pokemon's
// independent ability/item/spread/tera-type frequencies into weighted
// trait-combo candidates (their cross product), plus marginal move usage
// rates and teammate co-occurrence — chaos stats carry no per-set move
// associations, so a move list can never be read off directly the way a
// full moveset dataset (team-datasets.js) can.
import { toId } from './normalize.js';
import { traitComboMakesSense } from './set-rules.js';
import { cacheGet, cacheSet } from './cache.js';

const TOP_SPREADS = 20;
const TOP_ITEMS = 10;
const TOP_TERA_TYPES = 6;
const TOP_MOVES = 100;
const EV_COALESCE_WINDOW = 252 / 4; // spreads_are_alike's tolerance

function currentPeriod(monthsBack) {
    const d = new Date();
    d.setUTCDate(1); // avoid month rollover surprises when subtracting months
    d.setUTCMonth(d.getUTCMonth() - monthsBack);
    return { year: d.getUTCFullYear(), month: String(d.getUTCMonth() + 1).padStart(2, '0') };
}

function statsUrl(baseFormat, monthsBack) {
    const { year, month } = currentPeriod(monthsBack);
    return `https://www.smogon.com/stats/${year}-${month}/chaos/${baseFormat}-0.json`;
}

// Same "always use last month's stats, fall back further back if that
// month isn't published yet" behavior as
// SmogonSets._get_smogon_stats_file_name / the 404 retry in
// _get_smogon_stats_json.
async function fetchChaosJson(baseFormat) {
    for (const monthsBack of [1, 2, 3]) {
        try {
            const res = await fetch(statsUrl(baseFormat, monthsBack));
            if (res.ok) {
                const body = await res.json();
                return body.data || {};
            }
        } catch (e) {
            // network error or CORS failure — try an older month
        }
    }
    return {};
}

async function fetchChaosJsonCached(baseFormat) {
    const { year, month } = currentPeriod(1);
    const cacheKey = `fp-smogon:${baseFormat}:${year}-${month}`;
    const cached = await cacheGet(cacheKey);
    if (cached) return cached;
    const data = await fetchChaosJson(baseFormat);
    await cacheSet(cacheKey, data);
    return data;
}

function spreadsAreAlike(a, b) {
    return a.every((v, i) => Math.abs(v - b[i]) <= EV_COALESCE_WINDOW);
}

function coalesceSpread(spreads, nature, evs, pct) {
    for (const spread of spreads) {
        if (spread.nature === nature && spreadsAreAlike(spread.evs, evs)) {
            spread.pct += pct;
            return;
        }
    }
    spreads.push({ nature, evs, pct });
}

function topFractions(table, total, { min = 0, limit = Infinity, excludeNothing = false } = {}) {
    return Object.entries(table || {})
        .filter(([name, count]) => count > min && !(excludeNothing && toId(name) === 'nothing'))
        .map(([name, count]) => [toId(name), count / total])
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit);
}

function buildPokemonEntry(info) {
    const total = info['Raw count'] || 1;

    const spreads = [];
    for (const [key, count] of Object.entries(info['Spreads'] || {})) {
        const pct = count / total;
        if (pct <= 0) continue;
        const [natureRaw, evsRaw] = key.split(':');
        const evs = evsRaw.split('/').map((v) => parseInt(v, 10) || 0);
        coalesceSpread(spreads, toId(natureRaw), evs, pct);
    }
    spreads.sort((a, b) => b.pct - a.pct);

    const items = topFractions(info['Items'], total, { limit: TOP_ITEMS });
    const abilities = topFractions(info['Abilities'], total);
    const moveUsage = topFractions(info['Moves'], total, { limit: TOP_MOVES, excludeNothing: true });
    const teraTypes = topFractions(info['Tera Types'], total, { limit: TOP_TERA_TYPES }).map(
        ([type, pct]) => [type === 'nothing' ? 'typeless' : type, pct]
    );

    const teammates = {};
    for (const [name, count] of Object.entries(info['Teammates'] || {})) {
        teammates[toId(name)] = count;
    }

    const traitCombos = [];
    for (const spread of spreads.slice(0, TOP_SPREADS)) {
        for (const [ability, abilityPct] of abilities.length ? abilities : [['none', 1]]) {
            for (const [item, itemPct] of items.length ? items : [['none', 1]]) {
                for (const [teraType, teraPct] of teraTypes.length ? teraTypes : [['typeless', 1]]) {
                    const set = {
                        ability,
                        item,
                        nature: spread.nature,
                        evs: spread.evs,
                        teraType,
                        count: abilityPct * itemPct * spread.pct * teraPct,
                    };
                    if (traitComboMakesSense(set)) traitCombos.push(set);
                }
            }
        }
    }
    traitCombos.sort((a, b) => b.count - a.count);

    return { traitCombos, moveUsage, teammates, rawCount: total };
}

// { [speciesId]: { traitCombos, moveUsage, teammates, rawCount } }
export async function buildSmogonData(formatId) {
    const raw = await fetchChaosJsonCached(formatId);
    const perPokemon = {};
    for (const [rawName, info] of Object.entries(raw)) {
        perPokemon[toId(rawName)] = buildPokemonEntry(info);
    }
    return perPokemon;
}

function traitComboAllowed(combo, revealed, impossible) {
    if (revealed.ability && combo.ability !== revealed.ability) return false;
    if (revealed.item && combo.item !== revealed.item) return false;
    if (impossible) {
        if (impossible.abilities && impossible.abilities.has(combo.ability)) return false;
        if (impossible.items && impossible.items.has(combo.item)) return false;
    }
    return true;
}

// Weighted-random pick among trait combos consistent with what's revealed
// (and not yet ruled out by inference) — Smogon usage counts *are* trusted
// as representative here, unlike TeamDatasets' uniform sampling, matching
// fp/search/standard_battles.py's `random.choices(..., weights=[s.count...])`.
export function sampleTraitCombo(speciesData, revealed, impossible) {
    if (!speciesData) return null;
    const candidates = speciesData.traitCombos.filter((c) => traitComboAllowed(c, revealed, impossible));
    if (!candidates.length) return null;
    const total = candidates.reduce((sum, c) => sum + c.count, 0);
    if (total <= 0) return candidates[0];
    let r = Math.random() * total;
    for (const c of candidates) {
        r -= c.count;
        if (r <= 0) return c;
    }
    return candidates[candidates.length - 1];
}

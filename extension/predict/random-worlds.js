// Port of foul-play's fp/search/random_battles.py: random battle formats
// have no team preview and no usage-stat-based prediction — Pokemon
// Showdown's own random-team generator draws each Pokemon from a fixed,
// per-species pool of full sets (extension/predict/randbats.js), so this
// samples hypothesis worlds the same two-part way prepare_random_battles
// does: match each *revealed* opponent Pokemon against that species' own
// remaining sets, then fill unrevealed slots by drawing fresh species from
// the whole pool subject to Pokemon Showdown's own team-generation rules
// (species clause, weakness/type/4x-weakness caps, at most one Mega
// Evolution).
import { runInference, applyInference } from '../inference/index.js';
import { toId } from './normalize.js';
import { calcStat } from '../state-builder.js';
import { natureMultiplier } from './natures.js';
import { typeEffectiveness, ALL_TYPES } from '../inference/type-chart.js';
import { resolveKey } from './species-match.js';
import { applySampledSet, buildGuessedPokemon } from './predictor.js';

// random_battles.py's sample_randombattle_pokemon only enforces the
// weakness/type/4x-weakness/mega caps for its first 10 draws, then lets
// them lapse so sampling can't loop forever once few species remain that
// could satisfy every constraint simultaneously. The species clause itself
// has no such lapse (a team can never really have two of the same species),
// so it gets its own much larger safety-net budget purely to guarantee
// termination against a corrupted/near-empty dataset.
const SOFT_CONSTRAINT_ATTEMPTS = 10;
const MAX_SAMPLE_ATTEMPTS = 200;

const MEGA_SUFFIX_RE = /mega[xy]?$/;

function isMegaSpeciesId(id) {
    return MEGA_SUFFIX_RE.test(id || '');
}

function cloneOppSide(oppSide) {
    return structuredClone(oppSide);
}

// Mirrors base.py's PokemonSet.speed_check: the observed speed_range already
// reflects whatever boosted the Pokemon's *effective* speed when it was
// timed against ours, so a Choice Scarf candidate's raw stat needs the same
// 1.5x applied before comparing against that range.
function speedStatFor(pkmn, set) {
    const ev = (set.evs && set.evs[5]) || 0;
    const stat = calcStat(pkmn.baseStats.spe, pkmn.level, false, 31, ev, natureMultiplier(set.nature, 'spe'));
    return set.item === 'choicescarf' ? Math.floor(stat * 1.5) : stat;
}

function inSpeedRange(pkmn, set) {
    if (!pkmn.speedRange) return true;
    const stat = speedStatFor(pkmn, set);
    return stat >= pkmn.speedRange.min && stat <= pkmn.speedRange.max;
}

// Port of base.py's PokemonSet.set_makes_sense / PokemonMoveset.makes_sense_on_pkmn
// (match_ability/match_item/speed_check/level_check/match_tera all true, as
// get_all_remaining_sets's first pass calls it).
function candidateAllowed(candidate, pkmn) {
    const { set, moves } = candidate;
    if (pkmn.ability && set.ability !== pkmn.ability) return false;
    if (pkmn.impossibleAbilities && pkmn.impossibleAbilities.has(set.ability)) return false;
    if (pkmn.item && set.item !== pkmn.item) return false;
    if (pkmn.impossibleItems && pkmn.impossibleItems.has(set.item)) return false;
    if (pkmn.level && set.level && pkmn.level !== set.level) return false;
    if (!inSpeedRange(pkmn, set)) return false;
    if (pkmn.terastallized && pkmn.teraType && set.teraType !== 'typeless' && toId(pkmn.teraType) !== set.teraType) {
        return false;
    }
    const revealedMoves = (pkmn.moves || []).map((m) => m.id).filter(Boolean);
    if (revealedMoves.some((mv) => !moves.includes(mv))) return false;
    return true;
}

// A revealed Pokemon can match its own species' sets, and — unless it's
// already known to have mega evolved — the Mega-form entries randbats keys
// separately (e.g. "charizardmegax"), since get_pkmn_sets_from_pkmn_name
// treats "holds a Mega Stone for this species" as a set on the base
// species, not a different one.
function candidatesForRevealedPokemon(bySpecies, pkmn) {
    const pool = [];
    const addAll = (key) => {
        for (const c of bySpecies[key] || []) pool.push({ ...c, speciesKey: key });
    };
    const baseKey = resolveKey(pkmn.species, pkmn.baseSpecies, bySpecies);
    if (baseKey) addAll(baseKey);
    if (!pkmn.megaEvolved) {
        const megaBase = pkmn.baseSpecies || pkmn.species;
        for (const suffix of ['mega', 'megax', 'megay']) addAll(`${megaBase}${suffix}`);
    }
    return pool;
}

function weightedPick(candidates) {
    const total = candidates.reduce((sum, c) => sum + c.set.count, 0);
    if (total <= 0) return candidates[Math.floor(Math.random() * candidates.length)];
    let r = Math.random() * total;
    for (const c of candidates) {
        r -= c.set.count;
        if (r <= 0) return c;
    }
    return candidates[candidates.length - 1];
}

// Weighted-random pick (by observed randbats count — prepare_random_battles
// uses `random.choices(..., weights=[s.pkmn_set.count ...])` here, unlike
// team-datasets.js's deliberately-uniform sampleFullSet) among sets
// consistent with what's revealed/inferred; falls back to every set for
// this species (ignoring ability/item/level/speed/tera/moves) if nothing
// survives — mirrors get_all_remaining_sets's own relaxed fallback pass, so
// a revealed Pokemon is never left with zero candidate sets.
function pickRemainingSet(pkmn, bySpecies) {
    const pool = candidatesForRevealedPokemon(bySpecies, pkmn);
    if (!pool.length) return null;
    const strict = pool.filter((c) => candidateAllowed(c, pkmn));
    return weightedPick(strict.length ? strict : pool);
}

// Mutates `pkmn` with a chosen randbats set. A set keyed under a Mega form
// means "this Pokemon holds that Mega Stone" — applied with the same
// always-already-evolved simplification extension/predict/worlds.js's
// maybeSampleMega uses elsewhere in this codebase, since nothing here models
// choosing to mega evolve mid-search.
function applyRandbatsSet(pkmn, candidate, dexMeta) {
    const { speciesKey } = candidate;
    if (isMegaSpeciesId(speciesKey)) {
        if (speciesKey !== pkmn.species) {
            const meta = dexMeta[speciesKey];
            if (meta) {
                pkmn.species = speciesKey;
                pkmn.types = meta.types;
                pkmn.baseTypes = meta.types;
                pkmn.baseStats = meta.baseStats;
                pkmn.weightkg = meta.weightkg;
            }
        }
        pkmn.megaEvolved = true;
    }
    if (!pkmn.level) pkmn.level = candidate.set.level;
    applySampledSet(pkmn, candidate);
}

function baseSpeciesIdOf(speciesKey, dexMeta) {
    const meta = dexMeta[speciesKey];
    return toId((meta && meta.baseSpecies) || speciesKey);
}

function usesSameSpecies(team, speciesKey, dexMeta) {
    const target = baseSpeciesIdOf(speciesKey, dexMeta);
    return team.some((p) => toId(p.baseSpecies || p.species) === target);
}

function countByType(team, predicate) {
    const counts = new Map(ALL_TYPES.map((t) => [t, 0]));
    for (const p of team) {
        for (const t of ALL_TYPES) {
            if (predicate(t, p)) counts.set(t, counts.get(t) + 1);
        }
    }
    return counts;
}

function exceedsAny(counts, max) {
    for (const v of counts.values()) if (v > max) return true;
    return false;
}

// Port of PS's own random-team-generation constraints, quoted directly in
// random_battles.py's docstring: no more than 3 Pokemon weak to any given
// typing, no more than 2 Pokemon of any given type, no more than 1 Pokemon
// with a 4x weakness — plus this codebase's own never-two-Mega-Evolutions
// rule (is_mega, checked the same way maybeSampleMega checks it elsewhere).
// Species clause is handled separately by usesSameSpecies, since (unlike
// these four) it's never allowed to lapse.
function violatesSoftConstraints(team) {
    const weakCounts = countByType(team, (t, p) => typeEffectiveness(t, p.types) > 1);
    if (exceedsAny(weakCounts, 3)) return true;

    const typeCounts = countByType(team, (t, p) => p.types.some((pt) => toId(pt) === t));
    if (exceedsAny(typeCounts, 2)) return true;

    const fourXCounts = countByType(team, (t, p) => typeEffectiveness(t, p.types) === 4);
    if (exceedsAny(fourXCounts, 1)) return true;

    if (team.filter((p) => isMegaSpeciesId(toId(p.species))).length > 1) return true;

    return false;
}

// Draws one fresh unrevealed opponent Pokemon from the whole randbats pool,
// uniformly over species and then uniformly over that species' sets (unlike
// pickRemainingSet's count-weighted pick for revealed Pokemon — matches
// sample_randombattle_pokemon's plain `random.choice` on both draws).
function sampleUnrevealedRandbatsPokemon(team, bySpecies, dexMeta) {
    const speciesKeys = Object.keys(bySpecies);
    if (!speciesKeys.length) return null;

    for (let attempt = 0; attempt < MAX_SAMPLE_ATTEMPTS; attempt++) {
        const speciesKey = speciesKeys[Math.floor(Math.random() * speciesKeys.length)];
        if (usesSameSpecies(team, speciesKey, dexMeta)) continue;

        const sets = bySpecies[speciesKey];
        if (!sets.length) continue;
        const candidate = { ...sets[Math.floor(Math.random() * sets.length)], speciesKey };

        const pkmn = buildGuessedPokemon(speciesKey, candidate.set.level, dexMeta);
        if (!pkmn) continue;
        applyRandbatsSet(pkmn, candidate, dexMeta);

        if (attempt < SOFT_CONSTRAINT_ATTEMPTS && violatesSoftConstraints([...team, pkmn])) continue;
        return pkmn;
    }
    return null;
}

// `snapshot` needs stepQueue/mySideId (page-bridge.js) and moveMeta/dexMeta.
// `bySpecies` is randbats.js's buildRandbatsData() result. Returns
// [{ oppSide, weight }, ...], `numWorlds` entries, weight = 1/numWorlds —
// same shape as extension/predict/worlds.js's sampleWorlds for standard tiers.
export function sampleRandomBattleWorlds(snapshot, bySpecies, gen, numWorlds) {
    const inference = runInference(snapshot, gen);
    const { dexMeta } = snapshot;

    const worlds = [];
    for (let i = 0; i < numWorlds; i++) {
        const oppSide = cloneOppSide(snapshot.oppSide);
        applyInference(oppSide, inference);

        const revealedPokemon = oppSide.pokemon.filter(Boolean);
        for (const pkmn of revealedPokemon) {
            const candidate = pickRemainingSet(pkmn, bySpecies);
            if (candidate) applyRandbatsSet(pkmn, candidate, dexMeta);
        }

        const team = [...revealedPokemon];
        for (let slot = 0; slot < oppSide.pokemon.length; slot++) {
            if (oppSide.pokemon[slot]) continue;
            const pkmn = sampleUnrevealedRandbatsPokemon(team, bySpecies, dexMeta);
            if (!pkmn) continue;
            oppSide.pokemon[slot] = pkmn;
            team.push(pkmn);
        }

        worlds.push({ oppSide, weight: 1 / numWorlds });
    }
    return worlds;
}

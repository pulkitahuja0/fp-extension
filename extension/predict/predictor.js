// Orchestrator — the only module popup.js calls. Fills in an opponent
// side's unrevealed traits (ability/item/moves/nature/EVs/tera) and,
// where a slot is still completely unseen, guesses the remaining species
// too. Mirrors foul-play's overall approach (fp/battle + fp/data/sets) but
// simplified to produce one best-guess state instead of a distribution,
// since poke-engine's WASM build here takes a single fixed state per call
// (see state-builder.js's own doc comment on this same limitation).
import { toId } from './normalize.js';
import { resolveKey } from './species-match.js';
import { buildSmogonData } from './smogon-sets.js';
import { buildTeamDatasets, findMatchingFullSet } from './team-datasets.js';
import { fullSetMakesSense } from './set-rules.js';

const DEFAULT_LEVEL = 100;

function revealedInfo(pkmn) {
    return {
        ability: pkmn.ability || null,
        item: pkmn.item || null,
        moves: (pkmn.moves || []).map((m) => m.id).filter(Boolean),
    };
}

// Smogon chaos stats have no move-to-set association, so moves are chosen
// greedily by usage rate: always keep whatever's already revealed, then
// add the next-most-used move that keeps the (trait combo + moves so far)
// combination logically sound, until 4 moves are picked.
function fillSmogonMoves(revealedMoves, moveUsage, set, moveMeta) {
    const moves = [...revealedMoves];
    for (const [mv] of moveUsage) {
        if (moves.length >= 4) break;
        if (moves.includes(mv)) continue;
        if (fullSetMakesSense(set, [...moves, mv], moveMeta)) moves.push(mv);
    }
    return moves;
}

function bestSmogonGuess(speciesData, revealed, moveMeta) {
    if (!speciesData) return null;
    for (const combo of speciesData.traitCombos) {
        if (revealed.ability && combo.ability !== revealed.ability) continue;
        if (revealed.item && combo.item !== revealed.item) continue;
        const moves = fillSmogonMoves(revealed.moves, speciesData.moveUsage, combo, moveMeta);
        return { set: combo, moves };
    }
    return null;
}

function applyPrediction(pkmn, prediction) {
    if (!prediction) return;
    const { set, moves } = prediction;
    if (!pkmn.ability) pkmn.ability = set.ability;
    if (!pkmn.item) pkmn.item = set.item;
    if (!pkmn.teraType && set.teraType && set.teraType !== 'typeless') pkmn.teraType = set.teraType.toUpperCase();
    pkmn.predictedNature = set.nature;
    pkmn.predictedEvs = set.evs;

    const known = new Set((pkmn.moves || []).map((m) => m.id).filter(Boolean));
    const emptySlots = (pkmn.moves || []).filter((m) => !m.id);
    for (const mv of moves) {
        if (known.has(mv)) continue;
        const slot = emptySlots.shift();
        if (!slot) break;
        slot.id = mv;
        slot.pp = null;
        slot.maxpp = null;
        known.add(mv);
    }
}

function predictOnePokemon(pkmn, { smogonData, teamDatasets, moveMeta }) {
    const revealed = revealedInfo(pkmn);

    const fullSetKey = resolveKey(pkmn.species, pkmn.baseSpecies, teamDatasets.bySpecies);
    if (fullSetKey) {
        const fullSet = findMatchingFullSet(teamDatasets.bySpecies, fullSetKey, revealed, moveMeta);
        if (fullSet) {
            applyPrediction(pkmn, fullSet);
            return;
        }
    }

    const smogonKey = resolveKey(pkmn.species, pkmn.baseSpecies, smogonData);
    if (smogonKey) {
        applyPrediction(pkmn, bestSmogonGuess(smogonData[smogonKey], revealed, moveMeta));
    }
}

// The "combination of Smogon usage stats and hardcoded teams" for slots
// that haven't been revealed at all yet: prefer a hardcoded team once
// enough of the opponent's identified Pokemon overlap with it (a
// recognized team is a much stronger signal than aggregate stats), else
// fall back to Smogon's Teammates co-occurrence data.
function guessRemainingSpecies(identifiedIds, hardcodedTeams, smogonData, slotCount) {
    let bestTeam = null;
    let bestOverlap = 1; // require at least 2 shared species to prefer a hardcoded team
    for (const team of hardcodedTeams) {
        const overlap = team.filter((p) => identifiedIds.has(p.species)).length;
        if (overlap > bestOverlap) {
            bestOverlap = overlap;
            bestTeam = team;
        }
    }
    if (bestTeam) {
        return bestTeam
            .filter((p) => !identifiedIds.has(p.species))
            .slice(0, slotCount)
            .map((p) => ({ species: p.species, hardcoded: p }));
    }

    const scores = new Map();
    for (const id of identifiedIds) {
        const entry = smogonData[id];
        if (!entry) continue;
        for (const [teammate, count] of Object.entries(entry.teammates)) {
            if (identifiedIds.has(teammate)) continue;
            scores.set(teammate, (scores.get(teammate) || 0) + count);
        }
    }
    return [...scores.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, slotCount)
        .map(([species]) => ({ species, hardcoded: null }));
}

function buildGuessedPokemon(species, level, dexMeta) {
    const meta = dexMeta[species];
    if (!meta) return null;
    return {
        species,
        baseSpecies: meta.baseSpecies || null,
        level,
        baseTypes: meta.types,
        types: meta.types,
        hp: null,
        maxhp: null,
        hpPercent: 100, // never seen — assume full health
        fainted: false,
        ability: '',
        item: '',
        status: '',
        sleepTurns: null,
        boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0 },
        moves: [0, 1, 2, 3].map(() => ({ id: '', pp: null, maxpp: null, disabled: false })),
        terastallized: false,
        teraType: null,
        megaEvolved: false,
        weightkg: meta.weightkg,
        volatiles: [],
        statsExact: null,
        baseStats: meta.baseStats,
    };
}

// Mutates `oppSide` in place: fills unrevealed ability/item/moves/nature/
// EVs/tera on Pokemon that have already been seen, and fills any still-null
// team slots with a guessed species + set. Best-effort — on any failure
// (offline, no data for this format) it leaves oppSide untouched and
// state-builder.js's own neutral-default fallback takes over.
export async function predictOpponentTeam(oppSide, formatId, { moveMeta = {}, dexMeta = {} } = {}) {
    let smogonData = {};
    let teamDatasets = { bySpecies: {}, hardcodedTeams: [] };
    try {
        [smogonData, teamDatasets] = await Promise.all([buildSmogonData(formatId), buildTeamDatasets(formatId)]);
    } catch (e) {
        return;
    }

    const revealedPokemon = oppSide.pokemon.filter(Boolean);
    for (const pkmn of revealedPokemon) {
        predictOnePokemon(pkmn, { smogonData, teamDatasets, moveMeta });
    }

    const identifiedIds = new Set(revealedPokemon.map((p) => toId(p.species)));
    const emptySlotCount = oppSide.pokemon.reduce((n, p) => n + (p ? 0 : 1), 0);
    if (emptySlotCount === 0) return;

    const level = revealedPokemon[0] ? revealedPokemon[0].level : DEFAULT_LEVEL;
    const guesses = guessRemainingSpecies(identifiedIds, teamDatasets.hardcodedTeams, smogonData, emptySlotCount);

    let guessIndex = 0;
    for (let i = 0; i < oppSide.pokemon.length && guessIndex < guesses.length; i++) {
        if (oppSide.pokemon[i]) continue;
        const guess = guesses[guessIndex++];
        const pkmn = buildGuessedPokemon(guess.species, level, dexMeta);
        if (!pkmn) continue;
        if (guess.hardcoded) {
            applyPrediction(pkmn, {
                set: {
                    ability: guess.hardcoded.ability,
                    item: guess.hardcoded.item,
                    nature: guess.hardcoded.nature,
                    evs: guess.hardcoded.evs,
                    teraType: guess.hardcoded.teraType,
                },
                moves: guess.hardcoded.moves,
            });
        } else {
            predictOnePokemon(pkmn, { smogonData, teamDatasets, moveMeta });
        }
        oppSide.pokemon[i] = pkmn;
    }
}

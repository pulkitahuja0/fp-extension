import { buildState } from './state-builder.js';
import { generationMechanicsForFormat } from './wasm-loader.js';
import { loadPredictionData } from './predict/predictor.js';
import { sampleWorlds } from './predict/worlds.js';
import { MctsPool } from './predict/mcts-pool.js';
import { aggregateMoves, agreementCount } from './predict/aggregate.js';
import { toId } from './predict/normalize.js';

const calcBtn = document.getElementById('calc');
const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');
const metaEl = document.getElementById('meta');
const myMovesEl = document.getElementById('my-moves');
const oppMovesEl = document.getElementById('opp-moves');
const myMovesHeadingEl = document.getElementById('my-moves-heading');
const oppMovesHeadingEl = document.getElementById('opp-moves-heading');
const searchBudgetEl = document.getElementById('search-budget');

let pool = null;

calcBtn.addEventListener('click', run);
window.addEventListener('unload', () => pool && pool.terminate());

function setStatus(text, isError = false) {
    statusEl.textContent = text;
    statusEl.classList.toggle('error', isError);
}

function fail(text) {
    setStatus(text, true);
    calcBtn.disabled = false;
}

async function run() {
    calcBtn.disabled = true;
    resultsEl.hidden = true;
    setStatus('Reading battle…');

    let tab;
    try {
        [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    } catch (e) {
        return fail('Could not access the current tab.');
    }
    if (!tab || !/^https:\/\/play\.pokemonshowdown\.com\//.test(tab.url || '')) {
        return fail('Open a Pokémon Showdown battle tab first.');
    }

    let snapshot;
    try {
        snapshot = await chrome.tabs.sendMessage(tab.id, { type: 'fp-get-snapshot' });
    } catch (e) {
        return fail('Could not reach the page — try reloading the Showdown tab. (' + (e && e.message ? e.message : e) + ')');
    }
    if (!snapshot || snapshot.error) {
        return fail((snapshot && snapshot.error) || 'No active battle found on this tab.');
    }

    const [numWorlds, iterationsPerWorld] = searchBudgetEl.value.split(',').map(Number);

    setStatus('Predicting opponent sets…');
    let gen, predictionData, worlds;
    try {
        gen = generationMechanicsForFormat(snapshot.formatId);
        predictionData = await loadPredictionData(snapshot.formatId);
        worlds = sampleWorlds(snapshot, predictionData, gen, numWorlds);
    } catch (e) {
        return fail('Failed to predict the opponent\'s team: ' + (e && e.message ? e.message : e));
    }

    setStatus('Building states…');
    const jobs = [];
    for (const world of worlds) {
        let stateStr;
        try {
            stateStr = buildState({ ...snapshot, oppSide: world.oppSide });
        } catch (e) {
            continue; // skip a world whose sampled state failed to build rather than aborting the whole search
        }
        jobs.push({ formatId: snapshot.formatId, stateStr, maxIterations: iterationsPerWorld, options: { tera: true }, weight: world.weight });
    }
    if (!jobs.length) {
        return fail('Could not build a search state for any sampled world.');
    }

    setStatus(`Thinking across ${jobs.length} sampled worlds… keep this popup open.`);
    const started = performance.now();
    try {
        if (!pool) pool = new MctsPool();
        const outcomes = await pool.runAll(jobs);
        const elapsed = ((performance.now() - started) / 1000).toFixed(1);

        const worldResults = outcomes.map((o, i) => ({ result: o.result || null, weight: jobs[i].weight }));
        const failures = outcomes.filter((o) => o.error).length;

        const rosterSpecies = {
            side_one: new Set(snapshot.mySide.pokemon.filter(Boolean).map((p) => toId(p.species))),
            side_two: new Set(snapshot.oppSide.pokemon.filter(Boolean).map((p) => toId(p.species))),
        };
        renderResult(worldResults, jobs.length, failures, elapsed, !!snapshot.teamPreview, rosterSpecies);
        setStatus('');
    } catch (e) {
        return fail('Engine error: ' + (e && e.message ? e.message : e));
    } finally {
        calcBtn.disabled = false;
    }
}

// poke-engine's MoveChoice::to_string() (rs-wasm/vendor/poke-engine/src/genx/state.rs)
// returns bare names with no "move:"/"switch:" prefix — "closecombat",
// "garchomp", "closecombat-tera" — so a switch can't be told apart from a
// move by the string alone. `speciesIds` is this side's known roster (from
// the snapshot, not the search result) — a choice is a switch/lead pick iff
// its name (stripped of a trailing -tera/-mega suffix, which only ever
// applies to move choices) matches a roster species id.
function formatChoice(choice, speciesIds, teamPreview) {
    const bareId = choice.replace(/-(tera|mega)$/, '');
    const isSwitch = speciesIds.has(bareId);
    const label = choice.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const prefix = isSwitch && !teamPreview ? 'Switch to ' : '';
    return prefix + label;
}

function renderMoveList(el, worldResults, side, speciesIds, teamPreview) {
    el.innerHTML = '';
    const { ranked, choice } = aggregateMoves(worldResults, side);
    const { agree, total } = agreementCount(worldResults, side, choice);
    const totalScore = ranked.reduce((sum, [, score]) => sum + score, 0) || 1;

    for (const [i, [move, score]] of ranked.entries()) {
        const pct = (score / totalScore) * 100;
        const li = document.createElement('li');
        li.classList.toggle('chosen', move === choice);
        li.innerHTML = `
            <span class="move-rank">${i + 1}</span>
            <span class="move-name">
                ${formatChoice(move, speciesIds, teamPreview)}
                <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
            </span>
            <span class="move-score">${pct.toFixed(0)}%</span>
        `;
        el.appendChild(li);
    }

    return { choice, agree, total };
}

function renderResult(worldResults, worldCount, failures, elapsed, teamPreview, rosterSpecies) {
    myMovesHeadingEl.textContent = teamPreview ? 'Best lead' : 'Your options';
    oppMovesHeadingEl.textContent = teamPreview ? 'Likely opponent lead' : 'Likely opponent response';

    const mine = renderMoveList(myMovesEl, worldResults, 'side_one', rosterSpecies.side_one, teamPreview);
    renderMoveList(oppMovesEl, worldResults, 'side_two', rosterSpecies.side_two, teamPreview);

    const failureNote = failures ? `, ${failures} world${failures === 1 ? '' : 's'} failed` : '';
    const agreementNote = mine.total ? ` — ${mine.agree}/${mine.total} worlds' own top pick agrees` : '';
    const teamPreviewNote = teamPreview ? ' — enter this order in Showdown\'s own team-preview screen' : '';
    metaEl.textContent = `${worldCount} sampled worlds in ${elapsed}s${failureNote}${agreementNote}${teamPreviewNote}`;
    resultsEl.hidden = false;
}

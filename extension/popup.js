import { bestMove } from './wasm-loader.js';
import { buildState } from './state-builder.js';
import { predictOpponentTeam } from './predict/predictor.js';

const calcBtn = document.getElementById('calc');
const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');
const metaEl = document.getElementById('meta');
const myMovesEl = document.getElementById('my-moves');
const oppMovesEl = document.getElementById('opp-moves');
const iterationsEl = document.getElementById('iterations');

calcBtn.addEventListener('click', run);

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

    setStatus('Predicting opponent sets…');
    await predictOpponentTeam(snapshot.oppSide, snapshot.formatId, {
        moveMeta: snapshot.moveMeta,
        dexMeta: snapshot.dexMeta,
    });

    setStatus('Building state…');
    let stateStr;
    try {
        stateStr = buildState(snapshot);
    } catch (e) {
        return fail('Failed to read the battle state: ' + e.message);
    }

    setStatus('Thinking… keep this popup open.');
    const iterations = parseInt(iterationsEl.value, 10);
    const started = performance.now();
    try {
        const result = await bestMove(snapshot.formatId, stateStr, iterations, { tera: true });
        const elapsed = ((performance.now() - started) / 1000).toFixed(1);
        renderResult(result, elapsed);
        setStatus('');
    } catch (e) {
        return fail('Engine error: ' + (e && e.message ? e.message : e));
    } finally {
        calcBtn.disabled = false;
    }
}

// `avg_score` is poke-engine's raw internal evaluation (a mix of heuristic
// board-state points and ±1 terminal win/loss reward), not a bounded
// probability — so we rank by it but display `visits` (how much of the
// search budget the tree devoted to this move, i.e. how strongly MCTS
// converged on it) as the intuitive "confidence" bar.
function renderMoveList(el, moves) {
    el.innerHTML = '';
    const sorted = [...moves].sort((a, b) => b.avg_score - a.avg_score);
    const totalVisits = Math.max(1, sorted.reduce((sum, m) => sum + m.visits, 0));
    for (const [i, m] of sorted.entries()) {
        const li = document.createElement('li');
        li.innerHTML = `
            <span class="move-rank">${i + 1}</span>
            <span class="move-name">
                ${formatChoice(m.choice)}
                <div class="bar-track"><div class="bar-fill" style="width:${(m.visits / totalVisits) * 100}%"></div></div>
            </span>
            <span class="move-score">${((m.visits / totalVisits) * 100).toFixed(0)}%</span>
        `;
        el.appendChild(li);
    }
}

function formatChoice(choice) {
    // poke-engine choice strings look like "move:closecombat", "switch:garchomp", "move:closecombat-tera"
    const [kind, name] = choice.split(':');
    const label = (name || choice).replace(/-/g, ' ');
    const prefix = kind === 'switch' ? 'Switch to ' : '';
    return prefix + label.replace(/\b\w/g, (c) => c.toUpperCase());
}

function renderResult(result, elapsed) {
    renderMoveList(myMovesEl, result.side_one);
    renderMoveList(oppMovesEl, result.side_two);
    metaEl.textContent = `${result.iterations} simulations in ${elapsed}s`;
    resultsEl.hidden = false;
}

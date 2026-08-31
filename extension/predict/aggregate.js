// Port of fp/search/main.py's select_move_from_mcts_results: blends the
// move-visit distributions from N independently-searched hypothesis worlds
// into one final choice — the cross-world policy-averaging step that is
// foul-play's actual "decide what to do" algorithm, as opposed to any single
// world's raw MCTS output.

const NEAR_TOP_THRESHOLD = 0.75; // keep only moves within 75% of the top blended score

// `worldResults` is [{ result, weight }, ...] where `result` is rs-wasm's
// best_move() shape ({ side_one, side_two, iterations }) or null/undefined
// for a world whose search failed (skipped, not treated as zero-weight —
// a failed world contributes nothing rather than penalizing every move).
// `side` selects 'side_one' (our own move choices) or 'side_two' (the
// opponent's predicted response).
//
// Returns { ranked: [[choice, score], ...] (all moves, sorted desc),
// survivors: (ranked, filtered to the near-top threshold), choice: the
// final weighted-random pick among survivors — not argmax, matching
// foul-play's deliberate non-determinism among near-ties }.
export function aggregateMoves(worldResults, side) {
    const scores = new Map();
    for (const { result, weight } of worldResults) {
        if (!result) continue;
        const options = result[side] || [];
        const totalVisits = options.reduce((sum, o) => sum + o.visits, 0) || 1;
        for (const option of options) {
            const contribution = weight * (option.visits / totalVisits);
            scores.set(option.choice, (scores.get(option.choice) || 0) + contribution);
        }
    }

    const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
    if (!ranked.length) return { ranked: [], survivors: [], choice: null };

    const top = ranked[0][1];
    const survivors = ranked.filter(([, score]) => score >= top * NEAR_TOP_THRESHOLD);

    const total = survivors.reduce((sum, [, score]) => sum + score, 0);
    let r = Math.random() * total;
    let choice = survivors[survivors.length - 1][0];
    for (const [move, score] of survivors) {
        r -= score;
        if (r <= 0) {
            choice = move;
            break;
        }
    }

    return { ranked, survivors, choice };
}

// How many worlds' top pick (their own highest-visit root move) agree with
// the final blended choice — surfaced in the UI as an intuitive "N/M worlds
// agree" confidence signal alongside the blended score.
export function agreementCount(worldResults, side, choice) {
    let agree = 0;
    let total = 0;
    for (const { result } of worldResults) {
        if (!result) continue;
        const options = result[side] || [];
        if (!options.length) continue;
        total++;
        const top = options.reduce((best, o) => (o.visits > best.visits ? o : best), options[0]);
        if (top.choice === choice) agree++;
    }
    return { agree, total };
}

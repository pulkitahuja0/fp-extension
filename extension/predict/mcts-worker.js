// Web Worker entry point: loads a poke-engine WASM variant and runs one
// best_move() search per message received. Exists so
// extension/predict/mcts-pool.js can run N sampled worlds' searches
// concurrently across real OS threads — the WASM engine itself is
// single-threaded, so without workers N worlds would mean N times the
// search time on one thread.
import { bestMove } from '../wasm-loader.js';

self.onmessage = async (event) => {
    const { id, formatId, stateStr, maxIterations, options } = event.data;
    try {
        const result = await bestMove(formatId, stateStr, maxIterations, options);
        self.postMessage({ id, result });
    } catch (e) {
        self.postMessage({ id, error: e && e.message ? e.message : String(e) });
    }
};

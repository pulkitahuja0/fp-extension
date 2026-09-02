// Spins up a small pool of Web Workers (extension/predict/mcts-worker.js,
// one poke-engine WASM instance each) so extension/predict/worlds.js's N
// sampled hypothesis worlds can be searched concurrently across real OS
// threads, instead of N times sequentially on one thread — the piece of
// foul-play's `ProcessPoolExecutor` parallelism (fp/search/main.py's
// find_best_move) a browser extension has to reach for via Workers instead
// of OS processes.

const DEFAULT_POOL_SIZE = 4;

export class MctsPool {
    constructor(size) {
        const hw = typeof navigator !== 'undefined' && navigator.hardwareConcurrency;
        this.size = Math.max(1, size || Math.min(DEFAULT_POOL_SIZE, hw || DEFAULT_POOL_SIZE));
        this.workers = [];
        this.nextId = 0;
    }

    _ensureWorkers() {
        while (this.workers.length < this.size) {
            const worker = new Worker(new URL('./mcts-worker.js', import.meta.url), { type: 'module' });
            this.workers.push(worker);
        }
    }

    // Runs one job per entry in `jobs` ({formatId, stateStr, maxIterations,
    // options}), spread across the pool. Resolves to an array of
    // { result } | { error } in the same order as `jobs`.
    async runAll(jobs) {
        this._ensureWorkers();
        const results = Array.from({ length: jobs.length });
        let nextJobIndex = 0;

        const runOnWorker = (worker) =>
            new Promise((resolveWorker) => {
                const pump = () => {
                    if (nextJobIndex >= jobs.length) {
                        resolveWorker();
                        return;
                    }
                    const jobIndex = nextJobIndex++;
                    const job = jobs[jobIndex];
                    const id = this.nextId++;
                    const onMessage = (event) => {
                        if (event.data.id !== id) return;
                        worker.removeEventListener('message', onMessage);
                        results[jobIndex] = event.data.error
                            ? { error: event.data.error }
                            : { result: event.data.result };
                        pump();
                    };
                    worker.addEventListener('message', onMessage);
                    worker.postMessage({ id, ...job });
                };
                pump();
            });

        await Promise.all(this.workers.map(runOnWorker));
        return results;
    }

    terminate() {
        for (const worker of this.workers) worker.terminate();
        this.workers = [];
    }
}

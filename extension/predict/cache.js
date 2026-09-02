// Thin wrapper around chrome.storage so a fetch failure or an unavailable
// storage area (e.g. running this module outside the extension, in a test)
// degrades to "no cache" instead of throwing.
//
// `local` persists across browser restarts — used for Smogon chaos stats,
// whose cache key already embeds the year-month so it self-invalidates.
// `session` (falls back to `local` on Chrome < 102) is cleared each browser
// session — used for Pokemon Showdown's curated sets, which foul-play caches
// to disk indefinitely but a short-lived popup doesn't need to.
function area(kind) {
    if (typeof chrome === 'undefined' || !chrome.storage) return null;
    if (kind === 'session' && chrome.storage.session) return chrome.storage.session;
    return chrome.storage.local || null;
}

async function get(kind, key) {
    const store = area(kind);
    if (!store) return undefined;
    try {
        const result = await store.get(key);
        return result[key];
    } catch {
        return undefined;
    }
}

async function set(kind, key, value) {
    const store = area(kind);
    if (!store) return;
    try {
        await store.set({ [key]: value });
    } catch {
        // best-effort cache; ignore quota/availability errors
    }
}

export const cacheGet = (key) => get('local', key);
export const cacheSet = (key, value) => set('local', key, value);
export const sessionCacheGet = (key) => get('session', key);
export const sessionCacheSet = (key, value) => set('session', key, value);

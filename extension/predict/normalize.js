// Same normalization Pokemon Showdown itself uses for ids (species, moves,
// items, abilities, natures, ...): lowercase, strip everything but letters
// and digits. Kept here (rather than importing page-bridge.js's copy)
// because these predict/ modules must run in the popup's own context, not
// the PS page's MAIN world.
export function toId(text) {
    if (!text) return '';
    return ('' + text).toLowerCase().replace(/[^a-z0-9]/g, '');
}

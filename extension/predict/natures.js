// The 25 natures, keyed by normalized id. `plus`/`minus` name the stat each
// nature boosts/hinders (10% each); the 5 neutral natures (hardy, docile,
// serious, bashful, quirky) have neither.
const NATURES = {
    hardy: {},
    docile: {},
    serious: {},
    bashful: {},
    quirky: {},
    lonely: { plus: 'atk', minus: 'def' },
    brave: { plus: 'atk', minus: 'spe' },
    adamant: { plus: 'atk', minus: 'spa' },
    naughty: { plus: 'atk', minus: 'spd' },
    bold: { plus: 'def', minus: 'atk' },
    relaxed: { plus: 'def', minus: 'spe' },
    impish: { plus: 'def', minus: 'spa' },
    lax: { plus: 'def', minus: 'spd' },
    timid: { plus: 'spe', minus: 'atk' },
    hasty: { plus: 'spe', minus: 'def' },
    jolly: { plus: 'spe', minus: 'spa' },
    naive: { plus: 'spe', minus: 'spd' },
    modest: { plus: 'spa', minus: 'atk' },
    mild: { plus: 'spa', minus: 'def' },
    quiet: { plus: 'spa', minus: 'spe' },
    rash: { plus: 'spa', minus: 'spd' },
    calm: { plus: 'spd', minus: 'atk' },
    gentle: { plus: 'spd', minus: 'def' },
    sassy: { plus: 'spd', minus: 'spe' },
    careful: { plus: 'spd', minus: 'spa' },
};

export function natureMultiplier(natureId, stat) {
    const nature = NATURES[natureId];
    if (!nature) return 1;
    if (nature.plus === stat) return 1.1;
    if (nature.minus === stat) return 0.9;
    return 1;
}

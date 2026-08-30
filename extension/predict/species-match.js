// Port of PokemonSets.get_pkmn_by_name_in_dict: prediction data is keyed by
// species id, but a live Pokemon can be a forme (mega, regional, Ogerpon
// mask, ...) that usage-stat data doesn't break out separately. Fall back
// to the base species before giving up.
export function resolveKey(speciesId, baseSpeciesId, pool) {
    if (speciesId && pool[speciesId]) return speciesId;
    if (baseSpeciesId && pool[baseSpeciesId]) return baseSpeciesId;
    return null;
}

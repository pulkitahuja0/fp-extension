// Loads the user's own hardcoded teams — see extension/data/teams/ — and
// parses standard Pokemon Showdown export text into structured Pokemon,
// mirroring the essentials of foul-play's fp/teams/team_converter.py
// (single_pokemon_export_to_dict). Teams live as plain .txt files (see
// extension/data/teams/gen9/ou/example.txt for the format) and are
// registered per-format in extension/data/teams/manifest.json, since this
// is an unbundled extension with no way to list a directory at runtime.
import { toId } from './normalize.js';

const EV_STAT_IDS = { hp: 0, atk: 1, def: 2, spa: 3, spd: 4, spe: 5 };
const NATURE_NAMES = new Set([
    'hardy', 'lonely', 'brave', 'adamant', 'naughty', 'bold', 'docile', 'relaxed', 'impish', 'lax',
    'timid', 'hasty', 'serious', 'jolly', 'naive', 'modest', 'mild', 'quiet', 'bashful', 'rash',
    'calm', 'gentle', 'sassy', 'careful', 'quirky',
]);

function parsePokemonBlock(block) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return null;

    let header = lines[0].replace(/\s*\((M|F)\)\s*/, '');
    let item = '';
    const atIndex = header.indexOf('@');
    if (atIndex >= 0) {
        item = toId(header.slice(atIndex + 1));
        header = header.slice(0, atIndex).trim();
    }
    // "Nickname (Species)" — the species is whatever's in parentheses; a
    // bare "Species" line has none.
    const parenMatch = header.match(/\(([^)]+)\)/);
    const species = toId(parenMatch ? parenMatch[1] : header);
    if (!species) return null;

    const pkmn = { species, item, ability: '', nature: 'serious', teraType: '', evs: [0, 0, 0, 0, 0, 0], moves: [] };

    for (const line of lines.slice(1)) {
        if (line.startsWith('Ability:')) {
            pkmn.ability = toId(line.slice('Ability:'.length));
        } else if (line.startsWith('Tera Type:')) {
            pkmn.teraType = toId(line.slice('Tera Type:'.length));
        } else if (line.startsWith('EVs:')) {
            for (const part of line.slice('EVs:'.length).split('/')) {
                const [amount, stat] = part.trim().split(/\s+/);
                const idx = EV_STAT_IDS[toId(stat)];
                if (idx !== undefined) pkmn.evs[idx] = parseInt(amount, 10) || 0;
            }
        } else if (line.startsWith('-')) {
            pkmn.moves.push(toId(line.slice(1)));
        } else if (line.startsWith('IVs:') || line.startsWith('Level:') || line.startsWith('Shiny:')) {
            // not needed for set prediction — final stats come from EVs/nature/level elsewhere
        } else {
            const natureWord = toId(line.split(/\s+/)[0]);
            if (NATURE_NAMES.has(natureWord) && line.toLowerCase().endsWith('nature')) {
                pkmn.nature = natureWord;
            }
        }
    }

    return pkmn;
}

export function parseTeamExport(text) {
    return text.split(/\n\s*\n/).map(parsePokemonBlock).filter(Boolean);
}

let manifestPromise = null;
function loadManifest() {
    if (!manifestPromise) {
        manifestPromise = fetch(chrome.runtime.getURL('data/teams/manifest.json'))
            .then((res) => (res.ok ? res.json() : {}))
            .catch(() => ({}));
    }
    return manifestPromise;
}

// Array of teams for this format, each an array of parsed Pokemon.
export async function loadHardcodedTeams(formatId) {
    const manifest = await loadManifest();
    const files = manifest[formatId] || [];
    const teams = [];
    for (const path of files) {
        try {
            const res = await fetch(chrome.runtime.getURL(`data/teams/${path}`));
            if (!res.ok) continue;
            const team = parseTeamExport(await res.text());
            if (team.length) teams.push(team);
        } catch (e) {
            // skip an unreadable/malformed team file rather than failing prediction entirely
        }
    }
    return teams;
}

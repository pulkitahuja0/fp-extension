// Scoped-down port of the parsing fp/battle/protocol.py does to extract
// per-turn *events* from Pokemon Showdown's raw protocol log — not full
// battle-state reconstruction (extension/page-bridge.js's snapshot already
// gives us final state; we only need the raw event stream inference.py's
// algorithms read). This is the shared substrate every extension/inference/
// module below consumes.
//
// Input is PS client's `battle.stepQueue`: the flat array of raw protocol
// lines (no leading room id) the client has received for this battle,
// exposed by page-bridge.js. Grouped into per-turn batches the same way
// fp/battle/protocol.py's process_battle_updates buffers a turn before
// analyzing it — several algorithms (e.g. speed-range narrowing) need to see
// an entire turn's moves at once to compare who acted first.

import { toId } from '../predict/normalize.js';

const HAZARD_NAMES = {
    'stealth rock': 'stealthrock',
    spikes: 'spikes',
    'toxic spikes': 'toxicspikes',
    'sticky web': 'stickyweb',
};

function splitLine(line) {
    const s = line.startsWith('|') ? line.slice(1) : line;
    return s.split('|');
}

function sideId(ident) {
    // idents look like "p1a: Landorus" / "p2: Landorus".
    return ident ? ident.slice(0, 2) : null;
}

function parseFromEffect(parts) {
    // "[from] item: Life Orb" / "[from] ability: Rough Skin" tags, present
    // on -damage/-heal/-activate/-enditem lines among others.
    let fromItem = null;
    let fromAbility = null;
    for (const part of parts) {
        if (part.startsWith('[from] item: ')) fromItem = toId(part.slice('[from] item: '.length));
        else if (part.startsWith('[from] ability: ')) fromAbility = toId(part.slice('[from] ability: '.length));
    }
    return { fromItem, fromAbility };
}

function parseHpStatus(hpStatusStr) {
    // "100/100" / "45/100 brn" / "0 fnt".
    if (!hpStatusStr || hpStatusStr.startsWith('0 fnt')) return { hp: 0, maxhp: 0, fainted: true, status: null };
    const [hpPart, statusPart] = hpStatusStr.split(' ');
    const [hp, maxhp] = hpPart.split('/').map(Number);
    return { hp, maxhp: maxhp || hp, fainted: false, status: statusPart || null };
}

// Groups raw protocol lines into turns. Everything before the first |turn|
// line is turn 0 (team preview / initial switch-in, not analyzed for
// speed/scarf/etc.).
function groupIntoTurns(stepQueue) {
    const turns = [{ turn: 0, lines: [] }];
    for (const raw of stepQueue || []) {
        const parts = splitLine(raw);
        if (parts[0] === 'turn') {
            turns.push({ turn: Number(parts[1]), lines: [] });
        } else {
            turns[turns.length - 1].lines.push(parts);
        }
    }
    return turns.filter((t) => t.turn > 0);
}

// Parses one turn's raw lines into the structured shape speed-range.js,
// choice-scarf.js, hidden-power-type.js, heavy-duty-boots.js, and
// damage-check.js consume. `moveMeta`/`mySide` come from the snapshot
// page-bridge.js already builds (moveMeta: id -> {priority, category, ...},
// mySide: 'p1'|'p2').
function parseTurn(lines, { moveMeta, mySide }) {
    const moves = [];
    const damageEvents = [];
    const hazardEvents = [];
    const switches = [];
    const abilityReveals = [];
    const itemReveals = [];
    let anySwitchedThisTurn = false;
    let anyCant = false;
    let anyConfusionSelfHit = false;
    let anySpeedOverride = false; // Custap Berry / Quick Claw / Quick Draw

    let lastMove = null; // the most recent `move` entry, for attaching -damage/-crit/-miss to it

    for (const parts of lines) {
        const [action, ...rest] = parts;
        switch (action) {
            case 'move': {
                const [ident, moveName, target] = rest;
                const moveId = toId(moveName);
                const meta = moveMeta && moveMeta[moveId];
                lastMove = {
                    side: sideId(ident) === mySide ? 'mine' : 'opponent',
                    pokemonIdent: ident,
                    moveId,
                    priority: meta ? meta.priority : 0,
                    targetIdent: target || null,
                    crit: false,
                    missed: false,
                    effectiveness: null,
                };
                moves.push(lastMove);
                break;
            }
            case 'switch':
            case 'drag': {
                const [ident, details] = rest;
                anySwitchedThisTurn = true;
                switches.push({
                    side: sideId(ident) === mySide ? 'mine' : 'opponent',
                    pokemonIdent: ident,
                    species: toId((details || '').split(',')[0]),
                });
                break;
            }
            case 'cant': {
                anyCant = true;
                break;
            }
            case '-crit': {
                if (lastMove) lastMove.crit = true;
                break;
            }
            case '-miss': {
                if (lastMove) lastMove.missed = true;
                break;
            }
            case '-resisted': {
                if (lastMove) lastMove.effectiveness = 'resisted';
                break;
            }
            case '-supereffective': {
                if (lastMove) lastMove.effectiveness = 'supereffective';
                break;
            }
            case '-immune': {
                if (lastMove) lastMove.effectiveness = 'immune';
                break;
            }
            case '-activate': {
                const [ident, effect] = rest;
                const effectId = toId(effect || '');
                if (effectId === 'confusion') anyConfusionSelfHit = true;
                if (
                    effectId.includes('quickclaw') ||
                    effectId.includes('quickdraw') ||
                    effectId.includes('custapberry')
                ) {
                    anySpeedOverride = true;
                }
                const hazard = HAZARD_NAMES[(effect || '').toLowerCase()];
                if (hazard === 'stickyweb') {
                    hazardEvents.push({
                        side: sideId(ident) === mySide ? 'mine' : 'opponent',
                        ident,
                        hazard,
                        triggered: true,
                    });
                }
                break;
            }
            case '-ability': {
                const [ident, ability] = rest;
                abilityReveals.push({
                    side: sideId(ident) === mySide ? 'mine' : 'opponent',
                    ident,
                    ability: toId(ability),
                });
                break;
            }
            case '-weather': {
                // Weather-setter abilities (Drought, Drizzle, Sand Stream,
                // Snow Warning) tag their `[from] ability:`/`[of]` source
                // directly on the -weather line rather than a separate
                // -ability line.
                const tags = rest.slice(1);
                const { fromAbility } = parseFromEffect(tags);
                const ofTag = tags.find((t) => t.startsWith('[of] '));
                if (fromAbility && ofTag) {
                    const ident = ofTag.slice('[of] '.length);
                    abilityReveals.push({
                        side: sideId(ident) === mySide ? 'mine' : 'opponent',
                        ident,
                        ability: fromAbility,
                    });
                }
                break;
            }
            case '-item': {
                const [ident, item] = rest;
                itemReveals.push({ side: sideId(ident) === mySide ? 'mine' : 'opponent', ident, item: toId(item) });
                break;
            }
            case '-enditem': {
                const [ident, item] = rest;
                if (toId(item) === 'custapberry') anySpeedOverride = true;
                itemReveals.push({ side: sideId(ident) === mySide ? 'mine' : 'opponent', ident, item: toId(item) });
                break;
            }
            case '-sidestart':
            case '-sideend':
                // Hazard *presence* is already tracked in the snapshot's
                // sideConditions; only per-turn *trigger* events (damage/status
                // from an existing hazard) matter here, handled below.
                break;
            case '-damage':
            case '-heal': {
                const [ident, hpStatus, ...tags] = rest;
                const { fromItem, fromAbility } = parseFromEffect(tags);
                const parsedHp = parseHpStatus(hpStatus);
                const event = {
                    side: sideId(ident) === mySide ? 'mine' : 'opponent',
                    ident,
                    action,
                    ...parsedHp,
                    fromItem,
                    fromAbility,
                    crit: lastMove ? lastMove.crit : false,
                    move: lastMove,
                };
                damageEvents.push(event);

                // A -damage line against the move's declared target, with no
                // -resisted/-supereffective/-immune marker already seen,
                // means neutral effectiveness (those markers, when present,
                // always precede the -damage line in PS's protocol).
                if (
                    action === '-damage' &&
                    lastMove &&
                    lastMove.targetIdent === ident &&
                    lastMove.effectiveness === null
                ) {
                    lastMove.effectiveness = 'neutral';
                }

                // Hazard-damage: -damage with [from] Stealth Rock/Spikes and
                // no preceding `move` this sub-action (hazards fire on
                // switch-in, not as a move's damage).
                const hazardTag = tags.find(
                    (t) => t.startsWith('[from]') && HAZARD_NAMES[t.slice('[from] '.length).toLowerCase()]
                );
                if (hazardTag) {
                    const hazard = HAZARD_NAMES[hazardTag.slice('[from] '.length).toLowerCase()];
                    hazardEvents.push({ side: event.side, ident, hazard, triggered: true });
                }
                break;
            }
            case '-status': {
                const [ident, status] = rest;
                if (status === 'psn' || status === 'tox') {
                    // Only meaningful as a toxic-spikes trigger if it happened
                    // on switch-in (no preceding move this sub-action).
                    if (!lastMove) {
                        hazardEvents.push({
                            side: sideId(ident) === mySide ? 'mine' : 'opponent',
                            ident,
                            hazard: 'toxicspikes',
                            triggered: true,
                        });
                    }
                }
                break;
            }
            default:
                break;
        }
    }

    return {
        moves,
        switches,
        damageEvents,
        hazardEvents,
        abilityReveals,
        itemReveals,
        anySwitchedThisTurn,
        anyCant,
        anyConfusionSelfHit,
        anySpeedOverride,
    };
}

// Parses the whole battle log into one entry per turn, in order.
export function parseBattleLog(stepQueue, { moveMeta, mySide }) {
    return groupIntoTurns(stepQueue).map((t) => ({ turn: t.turn, ...parseTurn(t.lines, { moveMeta, mySide }) }));
}

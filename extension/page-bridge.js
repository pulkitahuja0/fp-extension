// Runs in the page's MAIN world (see manifest.json), so it can see the
// Pokemon Showdown client's own globals: `PS` (the room/battle manager) and
// the dex tables (`BattlePokedex`, `BattleMovedex`). It has no access to
// chrome.* APIs — content.js (isolated world) bridges it to the popup via
// window.postMessage.
//
// Its only job is to scrape the live battle into a plain-JSON "snapshot".
// Turning that snapshot into poke-engine's wire format happens in
// state-builder.js, which intentionally has no dependency on the PS client
// so it can be reasoned about (and eventually tested) on its own.

(() => {
    function toID(text) {
        if (!text) return '';
        return ('' + text).toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    function findBattleRoom() {
        const PS = window.PS;
        if (!PS || !PS.rooms) return null;

        const preferred = [PS.rightPanel, PS.leftPanel].filter((r) => r && r.battle);
        for (const room of preferred) {
            if (!room.battle.ended) return room;
        }
        for (const id in PS.rooms) {
            const room = PS.rooms[id];
            if (room && room.battle && !room.battle.ended) return room;
        }
        return null;
    }

    // PS tracks far more volatile statuses than we can confidently translate
    // (many are single-turn or interact with mechanics we don't model), so
    // we only forward ones that map cleanly onto poke-engine's own
    // PokemonVolatileStatus names and are meaningful as persistent state.
    const VOLATILE_ALLOWLIST = new Set([
        'confusion', 'substitute', 'leechseed', 'taunt', 'encore', 'torment', 'attract', 'curse', 'yawn',
        'flashfire', 'aquaring', 'ingrain', 'magnetrise', 'telekinesis', 'stockpile', 'minimize', 'saltcure',
        'syrupbomb', 'tarshot', 'octolock', 'noretreat', 'laserfocus', 'focusenergy', 'slowstart', 'truant',
        'unburden', 'nightmare', 'embargo', 'healblock', 'imprison', 'foresight', 'miracleeye', 'partiallytrapped',
        'perish4', 'perish3', 'perish2', 'perish1',
        'protosynthesisatk', 'protosynthesisdef', 'protosynthesisspa', 'protosynthesisspd', 'protosynthesisspe',
        'quarkdriveatk', 'quarkdrivedef', 'quarkdrivespa', 'quarkdrivespd', 'quarkdrivespe',
    ]);

    function snapshotBoosts(boosts) {
        boosts = boosts || {};
        return {
            atk: boosts.atk || 0,
            def: boosts.def || 0,
            spa: boosts.spa || 0,
            spd: boosts.spd || 0,
            spe: boosts.spe || 0,
            accuracy: boosts.accuracy || 0,
            evasion: boosts.evasion || 0,
        };
    }

    function movesFromTrack(pokemon) {
        const track = pokemon.moveTrack || [];
        if (track.length) {
            return track.map(([moveName, ppUsed]) => {
                const id = toID(moveName);
                const dex = window.BattleMovedex && window.BattleMovedex[id];
                const maxpp = dex ? Math.floor(dex.pp * 1.6) : 32;
                return { id, pp: Math.max(0, maxpp - (ppUsed || 0)), maxpp, disabled: false };
            });
        }
        return (pokemon.moves || []).map((id) => ({ id: toID(id), pp: null, maxpp: null, disabled: false }));
    }

    function buildPokemonSnapshot({ live, server, activeMoves, gen, isMine }) {
        const speciesForme = live.speciesForme || server.speciesForme;
        const id = toID(speciesForme);
        const dex = (window.BattlePokedex && window.BattlePokedex[id]) || {};
        const baseStats = dex.baseStats || { hp: 100, atk: 100, def: 100, spa: 100, spd: 100, spe: 100 };
        const baseTypes = (dex.types || ['Normal']).map((t) => t.toUpperCase());
        while (baseTypes.length < 2) baseTypes.push('TYPELESS');

        const terastallized = live.terastallized || '';
        const teraType = terastallized || server?.teraType || live.teraType || null;
        const types = terastallized ? [terastallized.toUpperCase(), 'TYPELESS'] : baseTypes;

        let hp, maxhp, hpPercent = null;
        if (server) {
            hp = server.hp;
            maxhp = server.maxhp;
        } else {
            hp = live.hp;
            maxhp = live.maxhp;
            if (maxhp === 100) hpPercent = hp; // PS normalizes unowned mons' HP to a /100 percentage
        }

        let ability = (server && (server.ability || server.baseAbility)) || live.ability || live.baseAbility || '';
        ability = toID(ability);
        let item = (server && server.item) || live.item || '';
        item = toID(item);

        let moves;
        if (isMine) {
            if (live.active && activeMoves) {
                moves = activeMoves.map((m) => ({
                    id: toID(m.id || m.move),
                    pp: m.pp,
                    maxpp: m.maxpp,
                    disabled: !!m.disabled,
                }));
            } else if (server && server.moves) {
                moves = server.moves.map((moveId) => {
                    const mid = toID(moveId);
                    const mdex = window.BattleMovedex && window.BattleMovedex[mid];
                    const maxpp = mdex ? Math.floor(mdex.pp * 1.6) : 32;
                    return { id: mid, pp: maxpp, maxpp, disabled: false };
                });
            } else {
                moves = movesFromTrack(live);
            }
        } else {
            moves = movesFromTrack(live);
        }
        while (moves.length < 4) moves.push({ id: '', pp: null, maxpp: null, disabled: false });

        const volatiles = Object.keys(live.volatiles || {}).filter((v) => VOLATILE_ALLOWLIST.has(v));

        return {
            species: id,
            level: live.level || server?.level || 100,
            baseTypes,
            types,
            hp,
            maxhp,
            hpPercent,
            fainted: !!live.fainted || hp === 0,
            ability,
            item,
            status: live.status || '',
            sleepTurns: live.statusData && live.status === 'slp' ? live.statusData.sleepTurns : null,
            boosts: snapshotBoosts(live.boosts),
            moves: moves.slice(0, 4),
            terastallized: terastallized ? terastallized.toUpperCase() : false,
            teraType: teraType ? teraType.toUpperCase() : null,
            megaEvolved: /-mega($|x$|y$)/i.test(speciesForme || ''),
            weightkg: dex.weightkg || 1,
            volatiles,
            statsExact: server && server.stats
                ? { atk: server.stats.atk, def: server.stats.def, spa: server.stats.spa, spd: server.stats.spd, spe: server.stats.spe }
                : null,
            baseStats,
        };
    }

    function buildSideSnapshot(side, { myPokemon, activeRequest, isMine }) {
        const serverByIdent = new Map((myPokemon || []).map((sp) => [sp.ident, sp]));
        const activeIdent = side.active && side.active[0] ? side.active[0].ident : null;

        const pokemon = side.pokemon.slice(0, 6).map((live) =>
            buildPokemonSnapshot({
                live,
                server: serverByIdent.get(live.ident) || null,
                activeMoves: live.ident === activeIdent ? activeRequest : null,
                isMine,
            })
        );
        while (pokemon.length < 6) {
            pokemon.push(null); // filled in with an "unknown" placeholder by state-builder.js
        }

        let activeIndex = side.pokemon.findIndex((p) => p.ident === activeIdent);
        if (activeIndex < 0) activeIndex = 0;

        const sc = side.sideConditions || {};
        const level = (id) => (sc[id] ? sc[id][1] : 0);
        const present = (id) => (sc[id] ? 1 : 0);

        return {
            activeIndex,
            forceSwitch: false, // filled in by caller for `mySide`; left false for the opponent unless their active fainted
            sideConditions: {
                spikes: level('spikes'),
                toxicSpikes: level('toxicspikes'),
                stealthrock: present('stealthrock'),
                reflect: present('reflect'),
                lightscreen: present('lightscreen'),
                auroraveil: present('auroraveil'),
                safeguard: present('safeguard'),
                mist: present('mist'),
                tailwind: present('tailwind'),
                luckychant: present('luckychant'),
                stickyweb: present('stickyweb'),
            },
            pokemon,
        };
    }

    function buildSnapshot() {
        const room = findBattleRoom();
        if (!room) {
            return { error: 'No active Pokemon Showdown battle found in this tab.' };
        }
        const battle = room.battle;
        const match = /^battle-([a-z0-9]+)-/.exec(room.id);
        if (!match) {
            return { error: `Could not determine the format from room id "${room.id}".` };
        }

        if (room.request && room.request.requestType === 'team') {
            return { error: 'Team preview is not supported yet — open the popup once the battle has started.', teamPreview: true };
        }
        if (battle.gameType !== 'singles') {
            return { error: `Only single battles are supported (this is "${battle.gameType}").`, doubles: true };
        }

        const activeRequest =
            room.request && room.request.requestType === 'move' && room.request.active
                ? room.request.active[0] && room.request.active[0].moves
                : null;

        const mySide = buildSideSnapshot(battle.nearSide, {
            myPokemon: battle.myPokemon,
            activeRequest,
            isMine: true,
        });
        mySide.forceSwitch = !!(room.request && room.request.requestType === 'switch');

        const oppSide = buildSideSnapshot(battle.farSide, { myPokemon: null, activeRequest: null, isMine: false });
        const oppActive = battle.farSide.active[0];
        oppSide.forceSwitch = !!(oppActive && oppActive.fainted && battle.farSide.pokemon.some((p) => !p.fainted));

        let weather = toID(battle.weather);
        let weatherTurns = battle.weatherTimeLeft || 0;
        let terrain = '';
        let terrainTurns = 0;
        let trickRoom = false;
        let trickRoomTurns = 0;
        for (const [name, , timeLeft] of battle.pseudoWeather || []) {
            const wid = toID(name);
            if (wid.endsWith('terrain')) {
                terrain = wid;
                terrainTurns = timeLeft;
            } else if (wid === 'trickroom') {
                trickRoom = true;
                trickRoomTurns = timeLeft;
            }
        }

        return {
            formatId: match[1],
            gen: battle.gen || 9,
            weather,
            weatherTurns,
            terrain,
            terrainTurns,
            trickRoom,
            trickRoomTurns,
            mySide,
            oppSide,
        };
    }

    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        if (!event.data || event.data.type !== 'fp-request-snapshot') return;
        let snapshot;
        try {
            snapshot = buildSnapshot();
        } catch (e) {
            snapshot = { error: 'Unexpected error reading the battle: ' + (e && e.message ? e.message : e) };
        }
        window.postMessage({ type: 'fp-snapshot-response', id: event.data.id, snapshot }, '*');
    });
})();

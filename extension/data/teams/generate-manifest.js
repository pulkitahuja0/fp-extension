#!/usr/bin/env node
// Regenerates manifest.json from whatever team .txt files exist under
// data/teams/<gen>/<format>/. hardcoded-teams.js can't list a directory at
// runtime (no build step for this extension — see predict/hardcoded-teams.js's
// header comment), so this script is the alternative: run it after adding
// or removing a team file, and it rebuilds the format -> file-list mapping
// for you instead of hand-editing manifest.json.
//
//   node extension/data/teams/generate-manifest.js
'use strict';

const fs = require('fs');
const path = require('path');

const TEAMS_DIR = __dirname;
const MANIFEST_PATH = path.join(TEAMS_DIR, 'manifest.json');

function subdirs(dir) {
    return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry) => entry.name)
        .sort();
}

// Only descends exactly data/teams/<gen>/<format>/*.txt, so root-level
// files (manifest.json itself, EXAMPLE.txt, this script) are never picked up.
function buildManifest() {
    const manifest = {};

    for (const gen of subdirs(TEAMS_DIR)) {
        const genPath = path.join(TEAMS_DIR, gen);
        for (const format of subdirs(genPath)) {
            const formatPath = path.join(genPath, format);
            const files = fs
                .readdirSync(formatPath, { withFileTypes: true })
                .filter((entry) => entry.isFile() && entry.name.endsWith('.txt') && !entry.name.startsWith('.'))
                .map((entry) => entry.name)
                .sort();

            if (!files.length) continue;

            const formatId = `${gen}${format}`; // "gen9" + "ou" -> "gen9ou", matching page-bridge.js's formatId
            manifest[formatId] = files.map((name) => `${gen}/${format}/${name}`);
        }
    }

    return manifest;
}

function main() {
    const manifest = buildManifest();
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');

    const teamCount = Object.values(manifest).reduce((n, files) => n + files.length, 0);
    const formatCount = Object.keys(manifest).length;
    console.log(`Wrote ${path.relative(process.cwd(), MANIFEST_PATH)}: ${teamCount} team file(s) across ${formatCount} format(s).`);
}

main();

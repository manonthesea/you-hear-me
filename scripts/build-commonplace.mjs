#!/usr/bin/env node
// Writes commonplace.html from the ledger and the sync manifest.
//
// Run by `npm run commonplace`, and automatically after every sync in
// the GitHub Actions workflow - which is the point of it living here.
// A map of the links that has to be rebuilt by hand is a map that is
// wrong every time it matters.
//
// Pass --site-root=https://... and --out=path to build the copy for
// somewhere other than this repo, where the poems are not sitting
// alongside the page and so cannot be reached by a relative link.

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';

import { buildDataset, renderCommonplace } from './lib/commonplace.mjs';
import { parseLedger, resolveLedger } from './lib/ledger.mjs';
import { parseManifest } from './lib/manifest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const TEMPLATE_PATH = path.join(REPO_ROOT, 'templates', 'commonplace-template.html');
const OUTPUT_PATH = path.join(REPO_ROOT, 'commonplace.html');

function argValue(name) {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
}

async function main() {
    const ledger = parseLedger(await readFile(path.join(REPO_ROOT, 'links.yml'), 'utf8'));
    const entries = parseManifest(
        await readFile(path.join(REPO_ROOT, '.poem-sync-manifest.json'), 'utf8')
    );

    const docToPath = new Map();
    for (const e of entries) {
        if (e.id && !e.id.startsWith('plate:')) docToPath.set(e.id, e.path);
    }

    const { bySource, pending, missingAssets } = resolveLedger(ledger, {
        pathForDoc: (doc) => docToPath.get(doc),
        assetExists: (rel) => existsSync(path.join(REPO_ROOT, rel)),
    });

    // Titles come from the pages themselves rather than the ledger,
    // because a poem with no ledger entry still needs its name.
    const titles = new Map();
    for (const e of entries) {
        if (!e.id || e.id.startsWith('plate:')) continue;
        const file = path.join(REPO_ROOT, e.path);
        if (!existsSync(file)) continue;
        const $ = cheerio.load(await readFile(file, 'utf8'));
        const h1 = $('h1').first().text().trim();
        if (h1) titles.set(e.path, h1);
    }

    const data = buildDataset({ ledger, entries, bySource, titles });
    const template = await readFile(TEMPLATE_PATH, 'utf8');
    const page = renderCommonplace(template, { ...data, siteRoot: argValue('site-root') ?? '' });

    const out = argValue('out') ? path.resolve(argValue('out')) : OUTPUT_PATH;
    const name = path.relative(REPO_ROOT, out) || out;
    let existing = null;
    try {
        existing = await readFile(out, 'utf8');
    } catch {
        // first run
    }
    if (existing === page) {
        console.log(`${name} is already current.`);
    } else {
        await writeFile(out, page, 'utf8');
        console.log(`${existing === null ? 'Created' : 'Updated'} ${name}`);
    }

    const connected = new Set();
    for (const e of data.edges) { connected.add(e.from); connected.add(e.to); }
    const unwoven = data.poems.filter((p) => !connected.has(p.key));
    console.log(
        `  ${data.poems.length} poems, ${data.edges.length} citations between them, ` +
            `${unwoven.length} not yet woven in.`
    );
    // The same two states the sync reports, repeated here because this
    // is often the command a person runs after editing links.yml.
    for (const p of pending) console.warn(`  waiting: "${p.phrase}" in ${p.from} - ${p.why}`);
    for (const m of missingAssets) console.warn(`  missing: ${m.why}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

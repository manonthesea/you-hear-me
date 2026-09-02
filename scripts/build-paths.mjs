#!/usr/bin/env node
// Writes paths.html from the ledger and the sync manifest.
//
// The Commonplace Book and this page are the same dataset seen two
// ways, so this reads that dataset rather than gathering its own -
// otherwise the map and the walk could disagree about the collection,
// which is the one thing neither is allowed to do.
//
// Run by `npm run paths`, and after every sync in the workflow.

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';

import { buildDataset } from './lib/commonplace.mjs';
import { parseLedger, resolveLedger } from './lib/ledger.mjs';
import { isPoem, parseManifest } from './lib/manifest.mjs';
import { chooseRoot, reachable, renderPaths } from './lib/walk.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const TEMPLATE_PATH = path.join(REPO_ROOT, 'templates', 'paths-template.html');
const OUTPUT_PATH = path.join(REPO_ROOT, 'paths.html');

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
    for (const e of entries) if (isPoem(e)) docToPath.set(e.id, e.path);

    const { bySource } = resolveLedger(ledger, {
        pathForDoc: (doc) => docToPath.get(doc),
        assetExists: (rel) => existsSync(path.join(REPO_ROOT, rel)),
    });

    const titles = new Map();
    for (const e of entries) {
        if (!isPoem(e)) continue;
        const file = path.join(REPO_ROOT, e.path);
        if (!existsSync(file)) continue;
        const $ = cheerio.load(await readFile(file, 'utf8'));
        const h1 = $('h1').first().text().trim();
        if (h1) titles.set(e.path, h1);
    }

    const { poems, edges } = buildDataset({ ledger, entries, bySource, titles });
    const root = chooseRoot(poems, edges);
    const template = await readFile(TEMPLATE_PATH, 'utf8');
    const page = renderPaths(template, {
        poems,
        edges,
        root,
        siteRoot: argValue('site-root') ?? '',
    });

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

    const { reached, furthest } = reachable(root, edges);
    const title = poems.find((p) => p.key === root)?.title ?? root;
    console.log(
        `  walking from "${title}": ${reached.size} of ${poems.length} poems reachable, ` +
            `${furthest} steps at the furthest.`
    );
    const unreachable = poems.length - reached.size;
    if (unreachable) console.log(`  ${unreachable} poems lie off every path from here.`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

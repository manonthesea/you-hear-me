#!/usr/bin/env node
// Writes maze.html: every poem reachable from the root, as a genealogy.
//
// Reads the same dataset the Commonplace Book and the Paths do, so the
// three pages cannot disagree about the collection. Run by
// `npm run maze`, and after every sync in the workflow.

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';

import { buildDataset } from './lib/commonplace.mjs';
import { parseLedger, resolveLedger } from './lib/ledger.mjs';
import { isPoem, parseManifest } from './lib/manifest.mjs';
import { buildMaze, renderMaze } from './lib/maze.mjs';
import { chooseRoot } from './lib/walk.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const TEMPLATE_PATH = path.join(REPO_ROOT, 'templates', 'maze-template.html');
const OUTPUT_PATH = path.join(REPO_ROOT, 'maze.html');

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
    const maze = buildMaze({ poems, edges, root });

    const template = await readFile(TEMPLATE_PATH, 'utf8');
    const page = renderMaze(template, { maze, root, siteRoot: argValue('site-root') ?? '' });

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

    console.log(
        `  ${maze.nodes.length} poems over ${maze.generations} generations, ` +
            `${maze.tree.length} lines of descent, ${maze.returns.length} doubling back ` +
            `(${maze.returns.filter((e) => e.to === root).length} to the root itself).`
    );
    if (maze.offPath.length) console.log(`  ${maze.offPath.length} poems no path from the root reaches.`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

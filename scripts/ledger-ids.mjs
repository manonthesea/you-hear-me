#!/usr/bin/env node
// Prints the "poems:" block for links.yml, ready to paste.
//
// Every ledger entry names a poem by a slug bound to its Drive Doc ID,
// and nobody should have to copy a 44-character identifier by hand. The
// manifest already records the ID of every published poem, and the page
// itself carries the title, so this needs no Drive credentials - just a
// repo that has synced at least once since identity was added.
//
//   npm run poems:ids
//
// Slugs are derived from titles as a starting point. Rename them freely:
// the slug is yours to choose and only has to be unique. What must not
// change afterwards is the Doc it is bound to.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPoem, parseManifest, poemsIn } from './lib/manifest.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = path.join(REPO_ROOT, '.poem-sync-manifest.json');

function slugify(title, taken) {
    const base =
        title
            .toLowerCase()
            .replace(/[’']/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 40) || 'poem';
    let slug = base;
    let n = 2;
    while (taken.has(slug)) slug = `${base}-${n++}`;
    taken.add(slug);
    return slug;
}

async function titleOf(filePath) {
    try {
        const html = await readFile(path.join(REPO_ROOT, filePath), 'utf8');
        const match = html.match(/<h1>([\s\S]*?)<\/h1>/);
        return match ? match[1].replace(/<[^>]*>/g, '').trim() : path.basename(filePath, '.html');
    } catch {
        return path.basename(filePath, '.html');
    }
}

// YAML needs quoting for a title with a colon, a leading indicator
// character, or anything else that would change how it parses.
function yamlString(value) {
    return /^[\w][\w .,'!?&()-]*$/.test(value) ? value : JSON.stringify(value);
}

async function main() {
    const entries = parseManifest(await readFile(MANIFEST_PATH, 'utf8'));
    const candidates = entries.filter((entry) => !entry.id || isPoem(entry));
    const withoutId = candidates.filter((entry) => !entry.id);
    if (withoutId.length > 0) {
        console.error(
            `${withoutId.length} of ${candidates.length} poems in the manifest have no Doc ID. ` +
                'Run a sync first — identity is recorded the next time poems are published.'
        );
        if (withoutId.length === candidates.length) process.exit(1);
    }

    const taken = new Set();
    const rows = [];
    // Plates carry an id too, so "has an id" was never the right test:
    // it offered every plate as a poem, each one titled "index".
    for (const entry of poemsIn(entries)) {
        const title = await titleOf(entry.path);
        rows.push({ slug: slugify(title, taken), doc: entry.id, title });
    }
    rows.sort((a, b) => a.slug.localeCompare(b.slug));

    const width = Math.max(...rows.map((r) => r.slug.length), 0) + 1;
    console.log('poems:');
    for (const row of rows) {
        console.log(
            `  ${(`${row.slug}:`).padEnd(width + 1)} { doc: ${row.doc}, title: ${yamlString(row.title)} }`
        );
    }
    console.error(`\n${rows.length} poem(s).`);
}

main().catch((err) => {
    console.error(err.message);
    process.exit(1);
});

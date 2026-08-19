// Repo-level integrity checks: things that are only wrong in the
// context of the whole site, so no unit test over a pure function
// would ever catch them.
//
// The first one comes from a real break. index.html - the site's only
// front door - redirected to a hand-made page, so retiring those pages
// would have 404'd the collection at its own root while every
// individual poem still worked perfectly.

import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');
const MANIFEST_PATH = path.join(REPO_ROOT, '.poem-sync-manifest.json');

async function syncedPages() {
    const raw = await readFile(MANIFEST_PATH, 'utf8');
    // Entries carry identity now ({id, path, permalink}); the bare-path
    // shape still appears in a manifest written before that.
    return new Set(
        JSON.parse(raw).pages.map((entry) => (typeof entry === 'string' ? entry : entry.path))
    );
}

// Every URL the page points at, decoded back to a repo path.
async function indexTargets() {
    const html = await readFile(path.join(REPO_ROOT, 'index.html'), 'utf8');
    const targets = [];
    for (const re of [/href="([^"]+)"/g, /url=([^"']+)/g, /location\.replace\('([^']+)'\)/g]) {
        for (const m of html.matchAll(re)) targets.push(decodeURIComponent(m[1].trim()));
    }
    return targets;
}

test('the front door points at a page the sync actually generates', async () => {
    // A hand-made target would work today and break the moment those
    // pages are retired - which is exactly how this broke before.
    const pages = await syncedPages();
    const targets = await indexTargets();

    assert.ok(targets.length > 0, 'index.html names no destination at all');
    for (const target of targets) {
        assert.ok(
            pages.has(target),
            `index.html points at "${target}", which the sync does not generate ` +
                '(a hand-made page, or a path that no longer exists)'
        );
    }
});

test('every route out of the front door agrees on one destination', async () => {
    // The canonical link, the meta refresh, the script and the visible
    // fallback must not drift apart - a reader with scripting disabled
    // should land where everyone else does.
    const targets = await indexTargets();

    assert.equal(new Set(targets).size, 1, `index.html names several destinations: ${[...new Set(targets)].join(', ')}`);
});

test("the front door's destination exists on disk", async () => {
    const [target] = await indexTargets();

    assert.ok(existsSync(path.join(REPO_ROOT, target)), `${target} is missing from the repo`);
});

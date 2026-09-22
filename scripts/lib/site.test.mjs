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

import { parseLedger } from './ledger.mjs';
import { plateSlug } from './plate.mjs';

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

test('the three views keep themselves out of search results', async () => {
    // Nothing on the site links to them, so a reader reaches the map
    // by being shown it. A search result would undo that quietly, and
    // the meta tag lives in a template a later edit could drop.
    for (const view of ['maze.html', 'paths.html', 'commonplace.html']) {
        const page = await readFile(path.join(REPO_ROOT, view), 'utf8');

        assert.match(page, /<meta name="robots" content="noindex">/, `${view} is missing its noindex`);
    }
});

test('no robots.txt overrides the noindex by forbidding the fetch', async () => {
    // A disallowed page is one the crawler never fetches, so it never
    // reads the noindex - and a page linked from anywhere else can stay
    // in the index as a bare URL. The two do not stack; noindex alone is
    // what removes a page. If a robots.txt is ever added, it must leave
    // these three reachable.
    const robots = path.join(REPO_ROOT, 'robots.txt');
    if (!existsSync(robots)) return;

    const text = await readFile(robots, 'utf8');
    for (const view of ['maze', 'paths', 'commonplace']) {
        assert.doesNotMatch(
            text,
            new RegExp(`^\\s*Disallow:\\s*/${view}\\.html`, 'mi'),
            `robots.txt disallows /${view}.html, which stops the crawler reading its noindex`
        );
    }
});

test('a portal still leads where its link says, after the picture changes', async () => {
    // A portal's destination belongs to the link - "to:" - and the
    // picture it passes through is only "via:". Swapping the picture
    // must not move the destination, and the two are far enough apart
    // in the ledger that nothing would complain if it did: the link
    // checker only asks whether the plate exists, not where it goes.
    //
    // This is the check that was wanted when Patton on the Rhine became
    // Cyborg Patton and the plate moved with it. It reads the built
    // plate rather than the ledger, so it covers the whole chain - slug
    // to Doc ID to published path to the href actually on the page.
    const ledger = parseLedger(await readFile(path.join(REPO_ROOT, 'links.yml'), 'utf8'));
    const pathForDoc = new Map(
        JSON.parse(await readFile(MANIFEST_PATH, 'utf8')).pages
            .filter((entry) => typeof entry !== 'string')
            .map((entry) => [entry.id, entry.path])
    );

    const portals = ledger.links.filter((link) => link.via);
    assert.ok(portals.length > 0, 'the ledger has no portals at all, which it should');

    for (const portal of portals) {
        const want = pathForDoc.get(ledger.poems.get(portal.to)?.doc);
        assert.ok(want, `the portal through "${portal.via}" leads to "${portal.to}", which has no synced page`);

        const plateDir = path.posix.join('plates', plateSlug(portal.via));
        const plate = path.join(REPO_ROOT, plateDir, 'index.html');
        assert.ok(existsSync(plate), `the portal through "${portal.via}" has no plate at ${plateDir}`);

        const page = await readFile(plate, 'utf8');
        const href = page.match(/id="back" href="([^"]+)"/)?.[1];
        assert.ok(href, `${plateDir} has no way back on it`);

        assert.equal(
            path.posix.join(plateDir, decodeURIComponent(href)),
            want,
            `clicking the picture on ${plateDir} leads somewhere other than "${portal.to}"`
        );

        // Pinned: a reader arriving from an unexpected poem must not
        // drag the destination along with them.
        assert.doesNotMatch(
            page,
            /getElementById\('back'\)\.href = from/,
            `${plateDir} lets the referrer override a destination the link chose`
        );
    }
});

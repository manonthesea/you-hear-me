// Tests for the record of what the sync generated.
//
// The manifest is the only thing that authorises a deletion, so the
// stakes here are asymmetric: a bug that loses an entry leaves a stale
// page lying around, while a bug that invents an empty manifest deletes
// the entire published site in one commit.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { PLATE_PREFIX, generatedPaths, isPoem, manifestBody, parseManifest, poemsIn } from './manifest.mjs';

const OLD = JSON.stringify({ pages: ['A.html', 'Early/B.html'] });
const NEW = JSON.stringify({
    pages: [
        { id: 'doc-a', path: 'A.html', permalink: 'p/aaaaaaaa/index.html' },
        { id: 'doc-b', path: 'Early/B.html', permalink: 'p/bbbbbbbb/index.html' },
    ],
});

// --- reading both shapes -------------------------------------------------

test('the old path-only manifest still parses', () => {
    // The first run after this change reads a manifest written by the
    // previous one. If that failed, every page would look orphaned.
    assert.deepEqual(parseManifest(OLD), [
        { id: null, path: 'A.html', permalink: null },
        { id: null, path: 'Early/B.html', permalink: null },
    ]);
});

test('a manifest with identity parses', () => {
    const entries = parseManifest(NEW);

    assert.equal(entries.length, 2);
    assert.equal(entries[0].id, 'doc-a');
    assert.equal(entries[0].permalink, 'p/aaaaaaaa/index.html');
});

test('an empty manifest is a legitimate state', () => {
    assert.deepEqual(parseManifest(JSON.stringify({ pages: [] })), []);
});

// --- refusing to guess ---------------------------------------------------

test('malformed JSON throws rather than reading as empty', () => {
    // Reading a corrupt manifest as empty would orphan - and therefore
    // delete - every published page. Failing the sync is the safe
    // outcome: nothing is lost by not publishing for one run.
    assert.throws(() => parseManifest('{ this is not json'), /not valid JSON/);
});

test('a manifest with no pages array throws', () => {
    assert.throws(() => parseManifest(JSON.stringify({ nope: [] })), /pages/);
});

test('an entry that is neither a path nor an object throws', () => {
    assert.throws(() => parseManifest(JSON.stringify({ pages: [42] })), /neither a path/);
});

// --- writing -------------------------------------------------------------

test('entries are written in a stable order', () => {
    // A re-run with no edits must produce no diff, or every sync commits
    // a reshuffled manifest and the history becomes unreadable.
    const shuffled = [
        { id: 'b', path: 'Early/B.html', permalink: 'p/b/index.html' },
        { id: 'a', path: 'A.html', permalink: 'p/a/index.html' },
    ];

    assert.deepEqual(
        manifestBody(shuffled).pages.map((p) => p.path),
        ['A.html', 'Early/B.html']
    );
    assert.deepEqual(manifestBody(shuffled), manifestBody([...shuffled].reverse()));
});

test('a written manifest reads back unchanged', () => {
    const entries = parseManifest(NEW);

    assert.deepEqual(parseManifest(JSON.stringify(manifestBody(entries))), entries);
});

// --- what the sync owns --------------------------------------------------

test('both the poem page and its permalink count as generated', () => {
    // Orphan selection works off this list, so a permalink whose poem
    // was unpublished is cleaned up by the same rule as the poem's page
    // - no second bookkeeping to drift out of step.
    assert.deepEqual(generatedPaths(parseManifest(NEW)), [
        'A.html',
        'p/aaaaaaaa/index.html',
        'Early/B.html',
        'p/bbbbbbbb/index.html',
    ]);
});

test('a page from before permalinks contributes only its path', () => {
    assert.deepEqual(generatedPaths(parseManifest(OLD)), ['A.html', 'Early/B.html']);
});

// --- poems and plates -----------------------------------------------------

test('a plate is not a poem, however much it looks like a page', () => {
    // Plates belong in the manifest - it is what authorises deleting
    // them - but they have no Doc behind them and must never be offered
    // as poems. "Has an id" was the test before, and plates have one.
    assert.equal(isPoem({ id: 'doc-abc', path: 'A.html' }), true);
    assert.equal(isPoem({ id: `${PLATE_PREFIX}patton.jpg`, path: 'plates/patton/index.html' }), false);
});

test('an entry with no id at all is not a poem either', () => {
    // A pre-identity manifest reads as {id: null}; nothing can bind a
    // slug to it, so it cannot be named in the ledger.
    for (const entry of [{ id: null }, {}, undefined]) {
        assert.equal(isPoem(entry), false, JSON.stringify(entry));
    }
});

test('the poems come back in the order they were given', () => {
    // Callers sort by their own rule afterwards; reordering here would
    // silently change the block "poems:ids" prints.
    const entries = parseManifest(
        JSON.stringify({
            pages: [
                { id: 'doc-b', path: 'B.html' },
                { id: `${PLATE_PREFIX}x.jpg`, path: 'plates/x/index.html' },
                { id: 'doc-a', path: 'A.html' },
            ],
        })
    );

    assert.deepEqual(poemsIn(entries).map((e) => e.id), ['doc-b', 'doc-a']);
});

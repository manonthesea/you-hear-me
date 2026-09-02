// Tests for the walk.
//
// The map and the walk read one dataset, so most of what could go wrong
// is already covered next door. What is only true here is the shape of
// a walk: where it starts, how far it can get, and that a graph which
// loops does not send anything into a circle it cannot leave.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { DEFAULT_ROOT, chooseRoot, describe, outgoing, reachable, renderPaths } from './walk.mjs';

// a -> b -> c -> a, and a -> d, with e off on its own.
const edges = [
    { from: 'a', to: 'b', phrase: 'first' },
    { from: 'b', to: 'c', phrase: 'second' },
    { from: 'c', to: 'a', phrase: 'back round' },
    { from: 'a', to: 'd', phrase: 'aside' },
];
const poems = ['a', 'b', 'c', 'd', 'e'].map((key) => ({ key, title: key.toUpperCase() }));

// --- where a walk begins --------------------------------------------------

test('the preferred poem is the root when it leads somewhere', () => {
    assert.equal(chooseRoot(poems, edges, 'b'), 'b');
});

test('a preferred poem that leads nowhere is not made the root', () => {
    // "d" is published and reachable but has no way out; starting there
    // is a walk that ends before it starts.
    assert.equal(chooseRoot(poems, edges, 'd'), 'a', 'should fall back to the busiest poem');
});

test('a preferred poem that no longer exists falls back rather than failing', () => {
    // Slugs are renameable, and two were renamed this month.
    assert.equal(chooseRoot(poems, edges, 'renamed-away'), 'a');
});

test('the ledger still names the poem the walk is meant to start from', async () => {
    // Asserting the constant equals itself would prove nothing. The
    // thing that can actually break is the binding: slugs are
    // renameable, and two were renamed this month. If this one is
    // renamed the page silently starts somewhere else, so read the real
    // ledger and say so instead.
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const { parseLedger } = await import('./ledger.mjs');

    const root = path.dirname(fileURLToPath(import.meta.url));
    const ledger = parseLedger(await readFile(path.join(root, '..', '..', 'links.yml'), 'utf8'));

    assert.ok(
        ledger.poems.has(DEFAULT_ROOT),
        `the walk starts from "${DEFAULT_ROOT}", which the ledger no longer names - ` +
            'rename it in walk.mjs to whichever slug that poem now has'
    );
});

// --- how far it gets ------------------------------------------------------

test('reach is counted by the shortest way round, not the first found', () => {
    const { depth } = reachable('a', edges);

    assert.equal(depth.get('a'), 0);
    assert.equal(depth.get('b'), 1);
    assert.equal(depth.get('d'), 1, 'a second branch off the root is still one step');
    assert.equal(depth.get('c'), 2);
});

test('a cycle is walked once, not forever', () => {
    // a -> b -> c -> a. A depth-first reach that did not mark what it
    // had seen would not return.
    const { reached, furthest } = reachable('a', edges);

    assert.deepEqual([...reached].sort(), ['a', 'b', 'c', 'd']);
    assert.equal(furthest, 2);
});

test('a poem no path reaches is simply not reached', () => {
    const { reached } = reachable('a', edges);

    assert.ok(!reached.has('e'));
});

test('a root with no links reaches only itself', () => {
    const { reached, furthest } = reachable('e', edges);

    assert.deepEqual([...reached], ['e']);
    assert.equal(furthest, 0, 'and does not report a distance it cannot travel');
});

// --- the adjacency --------------------------------------------------------

test('links keep the order the ledger gave them', () => {
    // The page numbers the choices for the keyboard, so the order has
    // to be the ledger's rather than whatever a Map happens to yield.
    assert.deepEqual(outgoing(edges).get('a').map((e) => e.phrase), ['first', 'aside']);
});

test('a poem with no links out is absent rather than empty', () => {
    assert.equal(outgoing(edges).get('d'), undefined);
});

// --- the page -------------------------------------------------------------

test('the description counts what the walk can actually reach', () => {
    const text = describe({ poems, edges, root: 'a' });

    assert.match(text, /4 of 5 poems/);
    assert.match(text, /furthest 2 steps/);
});

test('the data is embedded as parseable JSON, with the root named', () => {
    const page = renderPaths('<script id="d">{{DATA}}</script>{{SITE_ROOT}}{{DESCRIPTION}}', {
        poems, edges, root: 'a',
    });
    const parsed = JSON.parse(page.slice(page.indexOf('>') + 1, page.indexOf('</script>')));

    assert.equal(parsed.root, 'a');
    assert.equal(parsed.poems.length, 5);
    assert.equal(parsed.edges.length, 4);
});

test('a closing script tag in a phrase cannot end the block early', () => {
    const page = renderPaths('<script>{{DATA}}</script>{{SITE_ROOT}}{{DESCRIPTION}}', {
        poems: [{ key: 'a', title: 'A' }],
        edges: [{ from: 'a', to: 'a', phrase: '</script><b>oops' }],
        root: 'a',
    });

    assert.ok(!page.includes('</script><b>oops'));
    assert.match(page, /<\\\/script>/);
});

test('a "$" in a phrase survives substitution', () => {
    // "$&" and "$1" are replacement patterns to String.replace.
    const page = renderPaths('{{DATA}}{{SITE_ROOT}}{{DESCRIPTION}}', {
        poems: [{ key: 'a', title: 'A' }],
        edges: [{ from: 'a', to: 'a', phrase: 'paid $& and $1' }],
        root: 'a',
    });

    assert.ok(page.includes('paid $& and $1'));
});

test('every placeholder is filled', () => {
    const page = renderPaths('{{DATA}}|{{SITE_ROOT}}|{{DESCRIPTION}}', { poems, edges, root: 'a' });

    assert.doesNotMatch(page, /\{\{[A-Z_]+\}\}/);
});

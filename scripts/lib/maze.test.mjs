// Tests for the maze's shape.
//
// A drawn graph fails silently: it still looks like a diagram when it
// is describing the wrong collection. These pin the things that would
// go quietly wrong - a poem placed further out than it really is, two
// poems stacked in one spot, a line drawn as descent when it doubles
// back, or a numbering that disagrees with the page next door.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildMaze, describe, renderMaze } from './maze.mjs';

//        a
//      / | \        d is reachable at 2 (a>b>d) and at 3 (a>c>e>d)
//     b  c  f       e leads back to a
//     |  |          f leads nowhere
//     d  e
const edges = [
    { from: 'a', to: 'b', phrase: 'first' },
    { from: 'a', to: 'c', phrase: 'second' },
    { from: 'a', to: 'f', phrase: 'third' },
    { from: 'b', to: 'd', phrase: 'down' },
    { from: 'c', to: 'e', phrase: 'across' },
    { from: 'e', to: 'd', phrase: 'the long way' },
    { from: 'e', to: 'a', phrase: 'home again' },
];
const poems = ['a', 'b', 'c', 'd', 'e', 'f', 'z'].map((key) => ({
    key, title: key.toUpperCase(), path: key + '.html', sortKey: '2020-01-01', dated: true, base: key,
}));
const maze = () => buildMaze({ poems, edges, root: 'a' });

// --- where a poem stands --------------------------------------------------

test('a poem stands at its shortest distance from the root', () => {
    // D can be reached in two steps or in three. Two is where it lives;
    // placing it by whichever route was walked first would put half the
    // collection further out than it is.
    const at = new Map(maze().nodes.map((n) => [n.key, n.gen]));

    assert.equal(at.get('a'), 0);
    assert.equal(at.get('b'), 1);
    assert.equal(at.get('d'), 2, 'the long way round must not decide');
    assert.equal(at.get('e'), 2);
});

test('every poem but the root descends from exactly one', () => {
    const { nodes } = maze();

    assert.equal(nodes.find((n) => n.key === 'a').parent, null);
    for (const n of nodes.filter((n) => n.key !== 'a')) {
        assert.ok(n.parent, `${n.key} descends from nothing`);
    }
});

test('the phrase that reached a poem is carried with it', () => {
    assert.equal(maze().nodes.find((n) => n.key === 'd').via, 'down');
});

test('a poem no path reaches is set aside, not dropped', () => {
    const { offPath, nodes } = maze();

    assert.deepEqual(offPath.map((p) => p.key), ['z']);
    assert.ok(!nodes.some((n) => n.key === 'z'));
});

// --- which lines descend and which double back ----------------------------

test('a link to a poem already standing in the maze doubles back', () => {
    const { tree, returns } = maze();

    assert.equal(tree.length, 5, 'one line of descent per poem but the root');
    assert.deepEqual(
        returns.map((e) => `${e.from}->${e.to}`).sort(),
        ['e->a', 'e->d']
    );
});

test('every link is drawn exactly once, one way or the other', () => {
    // A link that is neither descent nor return is a link the maze does
    // not show, and nothing on the page would say so.
    const { tree, returns } = maze();

    assert.equal(tree.length + returns.length, edges.length);
});

test('a line home to the root doubles back like any other', () => {
    assert.ok(maze().returns.some((e) => e.to === 'a'));
});

// --- the numbering, shared with The Paths ---------------------------------

test('a link carries the number the walk gives it', () => {
    // The third line out of a poem here is the turn you take by pressing
    // 3 on The Paths. That only holds if both count the ledger's order,
    // over every link out of the poem - not over the descending ones.
    const { tree, returns } = maze();
    const outOfE = [...tree, ...returns].filter((e) => e.from === 'e').sort((x, y) => x.n - y.n);

    assert.deepEqual(outOfE.map((e) => [e.n, e.phrase]), [[1, 'the long way'], [2, 'home again']]);
    assert.deepEqual(outOfE.map((e) => e.of), [2, 2]);
});

test('numbering counts descending and doubling-back links together', () => {
    const { tree } = maze();
    const first = tree.find((e) => e.from === 'a' && e.to === 'f');

    assert.equal(first.n, 3, 'F is the third link out of A and stays the third');
});

// --- nothing hidden behind anything else ----------------------------------

test('no two poems occupy the same place', () => {
    const { nodes } = maze();
    const taken = new Set();

    for (const n of nodes) {
        const at = `${n.gen}:${n.row}`;
        assert.ok(!taken.has(at), `${n.title} is stacked on another poem at ${at}`);
        taken.add(at);
    }
});

test('a parent sits between its children', () => {
    // What makes it read as a genealogy rather than a list in columns.
    const { nodes } = maze();
    const at = new Map(nodes.map((n) => [n.key, n.row]));
    const kids = ['b', 'c', 'f'].map((k) => at.get(k));

    assert.ok(at.get('a') >= Math.min(...kids) && at.get('a') <= Math.max(...kids));
});

test('a run of poems with one child each stays a straight line', () => {
    const chain = buildMaze({
        poems: ['a', 'b', 'c'].map((key) => ({ key, title: key })),
        edges: [{ from: 'a', to: 'b', phrase: 'x' }, { from: 'b', to: 'c', phrase: 'y' }],
        root: 'a',
    });

    assert.deepEqual(chain.nodes.map((n) => n.row), [0, 0, 0]);
});

test('a root that leads nowhere is a maze of one', () => {
    const alone = buildMaze({ poems: [{ key: 'a', title: 'A' }], edges: [], root: 'a' });

    assert.equal(alone.nodes.length, 1);
    assert.equal(alone.generations, 1);
    assert.equal(alone.rows, 1);
    assert.deepEqual(alone.tree, []);
});

// --- the page -------------------------------------------------------------

test('the description counts what is actually drawn', () => {
    const text = describe(maze(), 'A');

    assert.match(text, /6 poems over 3 generations/, 'the six it places, not the seven it was given');
    assert.match(text, /5 lines of descent and 2 that double back/);
});

test('the data is embedded as parseable JSON', () => {
    const page = renderMaze('<script id="d">{{DATA}}</script>{{SITE_ROOT}}{{DESCRIPTION}}', {
        maze: maze(), root: 'a',
    });
    const parsed = JSON.parse(page.slice(page.indexOf('>') + 1, page.indexOf('</script>')));

    assert.equal(parsed.root, 'a');
    assert.equal(parsed.nodes.length, 6);
});

test('a closing script tag in a phrase cannot end the block early', () => {
    const hostile = buildMaze({
        poems: [{ key: 'a', title: 'A' }, { key: 'b', title: 'B' }],
        edges: [{ from: 'a', to: 'b', phrase: '</script><b>oops' }],
        root: 'a',
    });
    const page = renderMaze('<script>{{DATA}}</script>{{SITE_ROOT}}{{DESCRIPTION}}', { maze: hostile, root: 'a' });

    assert.ok(!page.includes('</script><b>oops'));
    assert.match(page, /<\\\/script>/);
});

test('a "$" in a phrase survives substitution', () => {
    const dollars = buildMaze({
        poems: [{ key: 'a', title: 'A' }, { key: 'b', title: 'B' }],
        edges: [{ from: 'a', to: 'b', phrase: 'paid $& and $1' }],
        root: 'a',
    });
    const page = renderMaze('{{DATA}}{{SITE_ROOT}}{{DESCRIPTION}}', { maze: dollars, root: 'a' });

    assert.ok(page.includes('paid $& and $1'));
});

test('every placeholder is filled', () => {
    const page = renderMaze('{{DATA}}|{{SITE_ROOT}}|{{DESCRIPTION}}', { maze: maze(), root: 'a' });

    assert.doesNotMatch(page, /\{\{[A-Z_]+\}\}/);
});

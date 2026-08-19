// Tests for the link ledger.
//
// The distinction under test throughout: a mistake in the file fails
// immediately and names the entry, while a poem that simply is not
// published yet is reported and skipped. Collapsing those two would
// either block the whole sync on a poem the poet has not finished, or
// let a typo silently drop a link forever.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { hrefFor, parseLedger, resolveLedger } from './ledger.mjs';

const LEDGER = `
poems:
  snafu:         { doc: doc-snafu, title: SNAFU }
  march-25-1945: { doc: doc-march, title: "March 25th, 1945" }
  osiris:        { doc: doc-osiris }
  unpublished:   { doc: doc-nowhere }

links:
  - from: snafu
    phrase: repetitive repetition
    to: march-25-1945
  - from: snafu
    phrase: "Fussell, Paul."
    href: https://en.wikipedia.org/wiki/Paul_Fussell
  - from: osiris
    phrase: Black Mud Sound
    asset: scan0005.jpg
  - from: snafu
    phrase: a troglodyte world
    to: unpublished
`;

const world = {
    pathForDoc: (doc) =>
        ({
            'doc-snafu': '$Pre-2010/11.26.10.html',
            'doc-march': '$Pre-2010/3.3.10.html',
            'doc-osiris': '$Pre-2010/Circa 2010.html',
        })[doc],
    assetExists: (p) => p === 'scan0005.jpg',
};

// --- parsing -------------------------------------------------------------

test('a ledger parses into poems and links', () => {
    const ledger = parseLedger(LEDGER);

    assert.equal(ledger.poems.size, 4);
    assert.equal(ledger.poems.get('snafu').doc, 'doc-snafu');
    assert.equal(ledger.links.length, 4);
});

test('an empty ledger is valid', () => {
    assert.deepEqual(parseLedger('').links, []);
    assert.deepEqual(parseLedger('poems: {}\nlinks: []').links, []);
});

test('a poem may be defined with no title', () => {
    assert.equal(parseLedger(LEDGER).poems.get('osiris').title, null);
});

// --- mistakes in the file fail loudly ------------------------------------

test('invalid YAML fails with the parser message', () => {
    assert.throws(() => parseLedger('poems: {\n  broken'), /not valid YAML/);
});

test('a poem without a Doc ID fails', () => {
    assert.throws(() => parseLedger('poems:\n  snafu: { title: SNAFU }'), /needs a "doc"/);
});

test('two slugs bound to one Doc fail', () => {
    // Two names for one poem means the ledger disagrees with itself
    // about identity, and which one wins would be arbitrary.
    assert.throws(
        () => parseLedger('poems:\n  a: { doc: same }\n  b: { doc: same }'),
        /same Doc/
    );
});

test('a link from an unknown poem fails and names it', () => {
    assert.throws(
        () => parseLedger('poems:\n  a: { doc: d }\nlinks:\n  - { from: nope, phrase: x, to: a }'),
        /unknown poem: "nope"/
    );
});

test('a link to an unknown poem fails and names it', () => {
    assert.throws(
        () => parseLedger('poems:\n  a: { doc: d }\nlinks:\n  - { from: a, phrase: x, to: ghost }'),
        /unknown poem: "ghost"/
    );
});

test('a link with no destination fails', () => {
    assert.throws(
        () => parseLedger('poems:\n  a: { doc: d }\nlinks:\n  - { from: a, phrase: x }'),
        /exactly one of/
    );
});

test('a link with two destinations fails', () => {
    assert.throws(
        () =>
            parseLedger(
                'poems:\n  a: { doc: d }\nlinks:\n  - { from: a, phrase: x, to: a, href: "https://e" }'
            ),
        /exactly one of/
    );
});

test('a link with no phrase fails', () => {
    assert.throws(
        () => parseLedger('poems:\n  a: { doc: d }\nlinks:\n  - { from: a, to: a }'),
        /needs "phrase"/
    );
});

test('the same anchor linked twice in one poem fails', () => {
    // The second could never match: a valid anchor occurs exactly once,
    // and the first entry already claimed it.
    assert.throws(
        () =>
            parseLedger(
                'poems:\n  a: { doc: d }\n  b: { doc: e }\n' +
                    'links:\n  - { from: a, phrase: dusk, to: b }\n  - { from: a, phrase: dusk, to: b }'
            ),
        /repeats the anchor/
    );
});

test('the same phrase in two different poems is fine', () => {
    const ledger = parseLedger(
        'poems:\n  a: { doc: d }\n  b: { doc: e }\n' +
            'links:\n  - { from: a, phrase: dusk, to: b }\n  - { from: b, phrase: dusk, to: a }'
    );
    assert.equal(ledger.links.length, 2);
});

// --- resolving against what is actually published ------------------------

test('links are grouped by the page they are written into', () => {
    const { bySource } = resolveLedger(parseLedger(LEDGER), world);

    assert.deepEqual([...bySource.keys()].sort(), [
        '$Pre-2010/11.26.10.html',
        '$Pre-2010/Circa 2010.html',
    ]);
    assert.equal(bySource.get('$Pre-2010/11.26.10.html').length, 2);
});

test('a poem link resolves to the target its Doc is published at', () => {
    const { bySource } = resolveLedger(parseLedger(LEDGER), world);
    const [first] = bySource.get('$Pre-2010/11.26.10.html');

    assert.deepEqual(first.target, { kind: 'poem', path: '$Pre-2010/3.3.10.html' });
});

test('an external link is passed through untouched', () => {
    const { bySource } = resolveLedger(parseLedger(LEDGER), world);
    const external = bySource
        .get('$Pre-2010/11.26.10.html')
        .find((l) => l.phrase === 'Fussell, Paul.');

    assert.deepEqual(external.target, {
        kind: 'external',
        url: 'https://en.wikipedia.org/wiki/Paul_Fussell',
    });
});

test('an asset link resolves to its repo path', () => {
    const { bySource } = resolveLedger(parseLedger(LEDGER), world);
    const [asset] = bySource.get('$Pre-2010/Circa 2010.html');

    assert.deepEqual(asset.target, { kind: 'asset', path: 'scan0005.jpg' });
});

test('a link to an unpublished poem is pending, not an error', () => {
    // This is what lets the whole ledger be written before every poem
    // exists - the words stay, the link waits.
    const { pending, bySource } = resolveLedger(parseLedger(LEDGER), world);

    assert.equal(pending.length, 1);
    assert.match(pending[0].why, /"unpublished" is not published/);
    assert.equal(bySource.get('$Pre-2010/11.26.10.html').length, 2, 'the other links still apply');
});

test('a link FROM an unpublished poem is pending too', () => {
    const ledger = parseLedger(
        'poems:\n  ghost: { doc: doc-nowhere }\n  snafu: { doc: doc-snafu }\n' +
            'links:\n  - { from: ghost, phrase: x, to: snafu }'
    );
    const { pending, bySource } = resolveLedger(ledger, world);

    assert.equal(bySource.size, 0);
    assert.match(pending[0].why, /"ghost" is not published/);
});

test('a missing asset is reported separately from an unpublished poem', () => {
    // One is a mistake to fix; the other is a poem to finish. They need
    // different words in the log.
    const ledger = parseLedger(
        'poems:\n  osiris: { doc: doc-osiris }\n' +
            'links:\n  - { from: osiris, phrase: x, asset: gone.jpg }'
    );
    const { missingAssets, pending } = resolveLedger(ledger, world);

    assert.equal(pending.length, 0);
    assert.equal(missingAssets.length, 1);
    assert.match(missingAssets[0].why, /"gone\.jpg" is not in the repo/);
});

// --- the href actually written ------------------------------------------

test('a poem target is made relative to the page carrying the link', () => {
    // Pages sit at different depths, so a path stored relative in the
    // ledger would be wrong for every page but one.
    assert.equal(
        hrefFor({ kind: 'poem', path: '$Pre-2010/11.26.10.html' }, '2020-2021/3. Summer'),
        '../../$Pre-2010/11.26.10.html'
    );
    assert.equal(
        hrefFor({ kind: 'poem', path: '$Pre-2010/3.3.10.html' }, '$Pre-2010'),
        '3.3.10.html'
    );
});

test('a space in a folder name is percent-encoded', () => {
    assert.equal(
        hrefFor({ kind: 'poem', path: '2020-2021/1. Winter/2.4.21.html' }, ''),
        '2020-2021/1.%20Winter/2.4.21.html'
    );
});

test('an ampersand in a folder name is HTML-escaped', () => {
    // "2018-2019&" is a real folder; unescaped it truncates the attribute.
    assert.equal(
        hrefFor({ kind: 'poem', path: '2018-2019&/1. Winter/2.3.18.html' }, '$Pre-2010'),
        '../2018-2019&amp;/1.%20Winter/2.3.18.html'
    );
});

test('an asset is relative to the page too', () => {
    assert.equal(hrefFor({ kind: 'asset', path: 'scan0005.jpg' }, '$Pre-2010'), '../scan0005.jpg');
});

test('an external URL is passed through, escaped but not re-encoded', () => {
    // Re-encoding would double-escape a URL that already has percent
    // escapes in it.
    assert.equal(
        hrefFor({ kind: 'external', url: 'https://example.org/a%20b?x=1&y=2' }, 'deep/dir'),
        'https://example.org/a%20b?x=1&amp;y=2'
    );
});

// --- YAML shapes that bite ----------------------------------------------

test('a phrase containing a comma survives a flow mapping', () => {
    // Inside { }, a comma separates entries. An unquoted "Fussell, Paul."
    // parses as phrase "Fussell" plus a stray key - and because "Fussell"
    // occurs exactly once in that poem, it validated and linked the wrong,
    // shorter text. Silently. Exactly the failure this design exists to
    // prevent, so it gets a test of its own.
    const ledger = parseLedger(
        'poems:\n  a: { doc: d }\n' +
            'links:\n  - { from: a, phrase: "Fussell, Paul.", href: "https://e" }\n' +
            '  - { from: a, phrase: "Sledge, E. B.", href: "https://f" }'
    );

    assert.deepEqual(
        ledger.links.map((l) => l.phrase),
        ['Fussell, Paul.', 'Sledge, E. B.']
    );
});

test('a phrase with a colon, braces or a leading indicator survives', () => {
    const ledger = parseLedger(
        'poems:\n  a: { doc: d }\n' +
            'links:\n  - { from: a, phrase: "of it all: the", to: a }\n' +
            '  - { from: a, phrase: "- a dash", to: a }\n' +
            '  - { from: a, phrase: "#hash {brace}", to: a }'
    );

    assert.deepEqual(
        ledger.links.map((l) => l.phrase),
        ['of it all: the', '- a dash', '#hash {brace}']
    );
});

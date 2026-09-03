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

// --- when the magnification happens --------------------------------------

const asset = (body) => parseLedger(`poems:\n  a: { doc: d }\nassets:\n  "p.jpg":\n${body}`);

test('an asset may say the zoom waits for a click', () => {
    const ledger = asset('    zoom: 3\n    "zoom-on": click');

    assert.equal(ledger.assets.get('p.jpg').zoom, 3);
    assert.equal(ledger.assets.get('p.jpg').zoomOn, 'click');
});

test('zoom defaults to happening on load', () => {
    assert.equal(asset('    zoom: 3').assets.get('p.jpg').zoomOn, 'load');
});

test('an unknown zoom-on fails rather than silently meaning "load"', () => {
    // A typo here would produce a plate that opens magnified when the
    // poet asked for the opposite - a wrong page, not a broken one, and
    // so the kind that survives a glance.
    assert.throws(() => asset('    zoom: 3\n    "zoom-on": hover'), /must be "load" or "click"/);
});

test('zoom-on with nothing to zoom fails', () => {
    assert.throws(() => asset('    "zoom-on": click'), /needs a "zoom"/);
});

test('scroll and zoom-on: click contradict each other and fail', () => {
    // Click-to-zoom places the view from where the reader clicked, so a
    // fixed opening position cannot also be honoured. Silently ignoring
    // one of them would leave the ledger saying something untrue.
    assert.throws(
        () => asset('    zoom: 3\n    "zoom-on": click\n    scroll: 0.5'),
        /scroll applies to "zoom-on: load"/
    );
});

test('scroll with zoom-on: load is still fine', () => {
    const cfg = asset('    zoom: 3\n    "zoom-on": load\n    scroll: 0.5').assets.get('p.jpg');

    assert.equal(cfg.scroll, 0.5);
    assert.equal(cfg.zoomOn, 'load');
});

// --- which part of the picture a magnified view frames -------------------

test('focus may be named, and lands on a fraction', () => {
    for (const [word, fraction] of [['left', 0], ['center', 0.5], ['centre', 0.5], ['right', 1]]) {
        const cfg = asset(`    zoom: 3\n    "zoom-on": click\n    focus: ${word}`).assets.get('p.jpg');
        assert.equal(cfg.focus, fraction, `focus: ${word}`);
    }
});

test('focus may be a fraction for anything in between', () => {
    assert.equal(asset('    zoom: 3\n    "zoom-on": click\n    focus: 0.3').assets.get('p.jpg').focus, 0.3);
});

test('focus defaults to unset, meaning the view follows the click', () => {
    assert.equal(asset('    zoom: 3\n    "zoom-on": click').assets.get('p.jpg').focus, null);
});

test('a misspelt focus fails rather than silently following the click', () => {
    // "lft" would otherwise produce a plate that ignores the instruction
    // entirely - a wrong page rather than a broken one.
    assert.throws(() => asset('    zoom: 3\n    "zoom-on": click\n    focus: lft'), /must be left, center, right/);
    assert.throws(() => asset('    zoom: 3\n    "zoom-on": click\n    focus: 2'), /must be left, center, right/);
});

test('focus on a plate that opens magnified fails, naming the option that fits', () => {
    assert.throws(
        () => asset('    zoom: 3\n    "zoom-on": load\n    focus: left'),
        /focus applies to "zoom-on: click"/
    );
});

// --- pictures on someone else's server -----------------------------------

const EMBED_LEDGER = `
poems:
  magritte: { doc: doc-magritte }
  party:    { doc: doc-party }
  unbuilt:  { doc: doc-nowhere }

embeds:
  tomb:
    title: The Tomb of the Wrestlers
    src: "https://example.org/tomb.jpg"
    to: magritte

links:
  - { from: party, phrase: "the red rose", embed: tomb }
`;

const embedWorld = {
    pathForDoc: (d) => ({ 'doc-magritte': '$Pre-2010/Circa 2003.html', 'doc-party': 'p/party.html' })[d],
    assetExists: () => false,
};

test('an embed parses, and a link may point at it by name', () => {
    const ledger = parseLedger(EMBED_LEDGER);

    assert.equal(ledger.embeds.get('tomb').src, 'https://example.org/tomb.jpg');
    assert.equal(ledger.embeds.get('tomb').to, 'magritte');
    assert.equal(ledger.links[0].embed, 'tomb');
});

test('an embed defaults to being framed', () => {
    assert.equal(parseLedger(EMBED_LEDGER).embeds.get('tomb').frame, 'iframe');
});

test('an embed link resolves to the embed, not to the URL', () => {
    // The whole point: the reader goes to a page of ours, which is what
    // lets the click lead somewhere.
    const { bySource } = resolveLedger(parseLedger(EMBED_LEDGER), embedWorld);

    assert.deepEqual(bySource.get('p/party.html')[0].target, { kind: 'embed', name: 'tomb' });
});

test('an embed whose destination is unpublished waits, like any other link', () => {
    // A plate that leads nowhere is worse than no plate; the words stay.
    const ledger = parseLedger(EMBED_LEDGER.replace('to: magritte', 'to: unbuilt'));
    const { bySource, pending } = resolveLedger(ledger, embedWorld);

    assert.equal(bySource.size, 0);
    assert.match(pending[0].why, /"unbuilt" is not published/);
});

test('an embed with no destination returns the reader to the poem', () => {
    // The same default an image plate has. A picture that illustrates
    // the poem it hangs beside should hand the reader back to it, and
    // requiring a destination would mean inventing one.
    const ledger = parseLedger('poems:\n  a: { doc: d }\nembeds:\n  t: { src: "https://e/x.jpg" }');

    assert.equal(ledger.embeds.get('t').to, null);
    assert.equal(ledger.embeds.get('t').href, null);
});

test('an embed with two destinations still fails', () => {
    assert.throws(
        () =>
            parseLedger(
                'poems:\n  a: { doc: d }\nembeds:\n  t: { src: "https://e/x.jpg", to: a, href: "https://f" }'
            ),
        /at most one of "to" or "href"/
    );
});

test('an embed src must be https', () => {
    // The site is served over https; an http frame would be blocked as
    // mixed content and show the reader nothing at all.
    assert.throws(
        () => parseLedger('poems:\n  a: { doc: d }\nembeds:\n  t: { src: "http://e/x.jpg", to: a }'),
        /must be an https URL/
    );
});

test('an embed naming an unknown poem fails', () => {
    assert.throws(
        () => parseLedger('poems:\n  a: { doc: d }\nembeds:\n  t: { src: "https://e/x.jpg", to: ghost }'),
        /unknown poem: "ghost"/
    );
});

test('a link naming an unknown embed fails', () => {
    assert.throws(
        () => parseLedger('poems:\n  a: { doc: d }\nlinks:\n  - { from: a, phrase: x, embed: ghost }'),
        /unknown embed: "ghost"/
    );
});

test('an embed and another destination on one link fail', () => {
    assert.throws(
        () =>
            parseLedger(
                'poems:\n  a: { doc: d }\nembeds:\n  t: { src: "https://e/x.jpg", to: a }\n' +
                    'links:\n  - { from: a, phrase: x, embed: t, to: a }'
            ),
        /exactly one of "to", "href", "asset" or "embed"/
    );
});

test('an unknown frame fails rather than quietly becoming an iframe', () => {
    assert.throws(
        () => parseLedger('poems:\n  a: { doc: d }\nembeds:\n  t: { src: "https://e/x.jpg", to: a, frame: object }'),
        /must be "iframe" or "image"/
    );
});

// --- whether a framed page can be used, or only returned from ------------

test('an embed is covered by default, as a picture wants', () => {
    const led = parseLedger('poems:\n  a: { doc: d }\nembeds:\n  t: { src: "https://e/x" }');

    assert.equal(led.embeds.get('t').cover, true);
});

test('cover: false is carried through for a page meant to be read', () => {
    const led = parseLedger('poems:\n  a: { doc: d }\nembeds:\n  t: { src: "https://e/x", cover: false }');

    assert.equal(led.embeds.get('t').cover, false);
});

test('a non-boolean cover fails rather than being read as truthy', () => {
    assert.throws(
        () => parseLedger('poems:\n  a: { doc: d }\nembeds:\n  t: { src: "https://e/x", cover: yes-please }'),
        /must be true or false/
    );
});

test('cover on an image embed fails, naming why it does not apply', () => {
    assert.throws(
        () => parseLedger('poems:\n  a: { doc: d }\nembeds:\n  t: { src: "https://e/x.jpg", frame: image, cover: false }'),
        /applies to "frame: iframe"/
    );
});

// --- portals ---------------------------------------------------------------
// "via" is the one key that does not decide where a link goes. It says
// the reader gets there by way of a picture, and the whole point of it
// is that the link stays a link between two poems: written as an
// "asset" the thread disappears from the map, the walk and the maze,
// and the poem it leaves reads as a dead end.

test('a portal keeps its destination and names the picture in the doorway', () => {
    const ledger = parseLedger(`
poems:
  a: { doc: doc-a, title: A }
  b: { doc: doc-b, title: B }
links:
  - { from: a, phrase: "pee", to: b, via: "patton.jpg" }
`);
    const { bySource } = resolveLedger(ledger, {
        pathForDoc: (d) => ({ 'doc-a': 'A.html', 'doc-b': 'B.html' })[d],
        assetExists: () => true,
    });

    assert.deepEqual(bySource.get('A.html')[0].target, {
        kind: 'portal',
        path: 'B.html',
        asset: 'patton.jpg',
    });
});

test('a portal is still a link to a poem, not to a picture', () => {
    // The distinction the whole feature exists for.
    const ledger = parseLedger(`
poems:
  a: { doc: doc-a, title: A }
  b: { doc: doc-b, title: B }
links:
  - { from: a, phrase: "pee", to: b, via: "patton.jpg" }
  - { from: a, phrase: "other", asset: "patton.jpg" }
`);
    const { bySource } = resolveLedger(ledger, {
        pathForDoc: (d) => ({ 'doc-a': 'A.html', 'doc-b': 'B.html' })[d],
        assetExists: () => true,
    });
    const [portal, plain] = bySource.get('A.html');

    assert.equal(portal.target.path, 'B.html', 'a portal names the poem it comes out at');
    assert.equal(plain.target.kind, 'asset', 'a plain asset link still stops at the picture');
    assert.equal(plain.target.path, 'patton.jpg');
});

test('a portal with no way out is refused', () => {
    // A picture with nothing on the far side of it.
    assert.throws(
        () => parseLedger(`
poems:
  a: { doc: doc-a, title: A }
links:
  - { from: a, phrase: "pee", via: "patton.jpg" }
`),
        /has "via" but no "to"/
    );
});

test('a portal whose picture is not in the repo waits, and says which picture', () => {
    // The same treatment a plain asset link gets - the poem is still
    // published, correct, and unlinked, rather than pointing at nothing.
    const ledger = parseLedger(`
poems:
  a: { doc: doc-a, title: A }
  b: { doc: doc-b, title: B }
links:
  - { from: a, phrase: "pee", to: b, via: "not-here-yet.jpg" }
`);
    const { bySource, missingAssets } = resolveLedger(ledger, {
        pathForDoc: (d) => ({ 'doc-a': 'A.html', 'doc-b': 'B.html' })[d],
        assetExists: () => false,
    });

    assert.equal(bySource.get('A.html'), undefined);
    assert.equal(missingAssets.length, 1);
    assert.match(missingAssets[0].why, /not-here-yet\.jpg/);
});

test('"via" must name an image, not be left empty', () => {
    assert.throws(
        () => parseLedger(`
poems:
  a: { doc: doc-a, title: A }
  b: { doc: doc-b, title: B }
links:
  - { from: a, phrase: "pee", to: b, via: "  " }
`),
        /via needs the name of an image/
    );
});

// Tests for the permanent per-poem URL.
//
// The pretty path of a poem comes from its Doc's name and has changed
// more than twenty times, taking every shared link with it. The
// permalink is derived from the Drive Doc ID instead, which survives
// renaming, retitling and moving.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
    findPermalinkCollisions,
    permalinkId,
    permalinkPath,
    renderPermalink,
} from './permalink.mjs';

// A real-shaped Drive file ID.
const DOC = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';

// --- the identifier ------------------------------------------------------

test('a Doc ID always produces the same permalink', () => {
    // This is the test that matters most in the file. The value is a
    // PUBLISHED URL: if the derivation changes, every link anyone has
    // shared stops working, silently and permanently. It is written as a
    // literal rather than recomputed so that changing the algorithm
    // fails here instead of in someone's browser months later.
    assert.equal(permalinkId(DOC), '2ndxg3ne');
});

test('the identifier is stable across calls', () => {
    assert.equal(permalinkId(DOC), permalinkId(DOC));
});

test('different Docs get different permalinks', () => {
    const ids = new Set(
        ['doc-a', 'doc-b', 'doc-c', DOC, `${DOC}x`].map((d) => permalinkId(d))
    );
    assert.equal(ids.size, 5);
});

test('the identifier needs no URL encoding', () => {
    // It goes straight into a path, so anything outside [a-z0-9] would
    // have to be escaped at every use site - and eventually would not be.
    for (const doc of ['a', 'b', DOC, 'ZZZ-999_x', '📄']) {
        assert.match(permalinkId(doc), /^[a-z0-9]{8}$/, `bad id for "${doc}"`);
    }
});

test('the permalink is a directory, so the URL ends at the identifier', () => {
    assert.equal(permalinkPath('2ndxg3ne'), 'p/2ndxg3ne/index.html');
});

// --- collisions ----------------------------------------------------------

test('no collisions among distinct Docs', () => {
    const entries = ['a', 'b', 'c'].map((id) => ({ id, filePath: `${id}.html` }));
    assert.deepEqual(findPermalinkCollisions(entries), []);
});

test('two poems sharing a permalink are reported, not silently ordered', () => {
    // Whichever was written last would win, leaving the other
    // unreachable by its permanent URL.
    const entries = [
        { id: 'same', filePath: 'One.html' },
        { id: 'same', filePath: 'Two.html' },
    ];
    const collisions = findPermalinkCollisions(entries);

    assert.equal(collisions.length, 1);
    assert.deepEqual(collisions[0].filePaths, ['One.html', 'Two.html']);
});

// --- the redirect page ---------------------------------------------------

function stub(filePath, title = 'SNAFU') {
    return renderPermalink({ id: DOC, title, filePath });
}

test('the redirect climbs out of p/<id>/ to reach the poem', () => {
    const page = stub('$Pre-2010/11.26.10.html');

    assert.match(page, /href="\.\.\/\.\.\/\$Pre-2010\/11\.26\.10\.html"/);
});

test('spaces in a folder name are percent-encoded', () => {
    // A raw space in a meta refresh URL is not reliably parsed, and
    // "1. Winter" is a real folder in this repo.
    const page = stub('2020-2021/1. Winter/2.4.21.html');

    assert.match(page, /2020-2021\/1\.%20Winter\/2\.4\.21\.html/);
    assert.doesNotMatch(page, /1\. Winter/);
});

test('an "&" in a folder name is HTML-escaped inside every attribute', () => {
    // "2018-2019&" is a real folder. Unescaped in an attribute, the
    // value is truncated or mangled depending on what follows it.
    // Scoped to attributes on purpose: the <script> route must carry a
    // RAW "&", so asserting over the whole page would forbid the correct
    // behaviour there.
    const page = stub('2018-2019&/1. Winter/2.3.18.html');
    const attrs = [
        ...[...page.matchAll(/href="([^"]+)"/g)].map((m) => m[1]),
        ...[...page.matchAll(/content="0;url=([^"]+)"/g)].map((m) => m[1]),
    ];

    assert.ok(attrs.length >= 3, 'expected canonical, refresh and visible link');
    for (const value of attrs) {
        assert.match(value, /2018-2019&amp;\//);
        assert.doesNotMatch(value, /2018-2019&\//);
    }
});

test('the script gets a JS string, not HTML-escaped text', () => {
    // Script content is raw text - the browser does NOT decode entities
    // inside it. An HTML-escaped path reaches location.replace() with a
    // literal "&amp;" and navigates to a page that does not exist. This
    // shipped once and was caught in a browser, not by a unit test.
    const page = stub('2018-2019&/1. Winter/2.3.18.html');
    const [, scriptArg] = page.match(/location\.replace\("([^"]+)"\)/);

    assert.match(scriptArg, /2018-2019&\//, 'script must carry a raw &');
    assert.doesNotMatch(scriptArg, /&amp;/, 'script must not carry an HTML entity');
});

test('every route resolves to the same real path once the browser decodes it', () => {
    // The routes live in three different escaping contexts, so comparing
    // them to each other proves nothing - the earlier version of this
    // test passed while all three were equally wrong. Decode each one
    // the way its own context would, then compare to the actual path.
    const target = '2018-2019&/1. Winter/2.3.18.html';
    const page = stub(target);

    const fromAttr = (v) => decodeURIComponent(v.replace(/&amp;/g, '&'));
    const routes = {
        canonical: fromAttr(page.match(/<link rel="canonical" href="([^"]+)"/)[1]),
        refresh: fromAttr(page.match(/content="0;url=([^"]+)"/)[1]),
        script: decodeURIComponent(JSON.parse(page.match(/location\.replace\((".*?")\)/)[1])),
        visible: fromAttr(page.match(/<a href="([^"]+)"/)[1]),
    };

    for (const [name, value] of Object.entries(routes)) {
        assert.equal(value, `../../${target}`, `${name} route resolves wrongly`);
    }
});

test('the poem, not the permalink, is the canonical page', () => {
    const page = stub('$Pre-2010/11.26.10.html');

    assert.match(page, /<link rel="canonical" href="\.\.\/\.\.\/\$Pre-2010\/11\.26\.10\.html">/);
    assert.match(page, /<meta name="robots" content="noindex,follow">/);
});

test("a title with markup characters cannot break out of the page", () => {
    const page = stub('A.html', 'Ampersands & <angles>');

    assert.match(page, /<title>Ampersands &amp; &lt;angles&gt;<\/title>/);
    assert.doesNotMatch(page, /<angles>/);
});

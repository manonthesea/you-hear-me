// Tests for the link sweep.
//
// The last test is the one that matters: it walks the real site and
// fails if any link on it does not resolve. The rest exist because that
// test is only as trustworthy as its resolver - a resolver that quietly
// forgave a bad path would pass forever while the site rotted.

import { strict as assert } from 'node:assert';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { MISSING, UNPUBLISHED, listFiles, published, resolveHref, sweep } from './sweep.mjs';

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const FILES = [
    'index.html',
    '$Pre-2010/11.26.10.html',
    '2020-2021/1. Winter/2.4.21.html',
    'plates/patton/index.html',
    'assets/images/patton.jpg',
    '_legacy/SNAFU.html',
];
const at = (fromDir) => ({ fromDir, pages: published(FILES), files: new Set(FILES) });

// --- reading an href ------------------------------------------------------

test('a link resolves relative to the page holding it', () => {
    const up = resolveHref('../../$Pre-2010/11.26.10.html', at('2020-2021/1. Winter'));

    assert.deepEqual(up, { kind: 'internal', target: '$Pre-2010/11.26.10.html' });
});

test('a percent-encoded path is decoded before it is matched', () => {
    // Every poem in a folder with a space in its name arrives this way.
    const found = resolveHref('2020-2021/1.%20Winter/2.4.21.html', at(''));

    assert.equal(found.target, '2020-2021/1. Winter/2.4.21.html');
});

test('a fragment or query is trimmed off the path', () => {
    for (const href of ['index.html#top', 'index.html?v=2', 'index.html?v=2#top']) {
        assert.equal(resolveHref(href, at('')).target, 'index.html', href);
    }
    assert.equal(resolveHref('#top', at('')).kind, 'skip');
});

test('an absolute link to our own site is judged as an internal one', () => {
    // It renders as a normal link and 404s as a normal link, so hiding
    // behind a hostname should not exempt it from the sweep.
    const good = resolveHref('https://manonthesea.github.io/you-hear-me/index.html', at(''));
    const bad = resolveHref('https://manonthesea.github.io/you-hear-me/nowhere.html', at(''));

    assert.equal(good.kind, 'internal');
    assert.equal(bad.kind, 'broken');
});

test('a link to another site is external, not broken', () => {
    for (const href of ['https://poetryfoundation.org/x', '//example.org/y']) {
        assert.equal(resolveHref(href, at('')).kind, 'external', href);
    }
});

test('mailto, tel and javascript are left alone', () => {
    for (const href of ['mailto:a@b.c', 'tel:+15550100', 'javascript:void(0)']) {
        assert.equal(resolveHref(href, at('')).kind, 'skip', href);
    }
});

// --- matching the way the server matches ----------------------------------

test('case is not forgiven, because the server does not forgive it', () => {
    // A resolver that matched case-insensitively would pass this link
    // and the reader would still get a 404.
    const found = resolveHref('$pre-2010/11.26.10.html', at(''));

    assert.equal(found.kind, 'broken');
    assert.equal(found.why, MISSING);
});

test('an extensionless path finds its .html, as GitHub Pages serves it', () => {
    assert.equal(resolveHref('index', at('')).target, 'index.html');
    assert.equal(resolveHref('plates/patton/', at('')).target, 'plates/patton/index.html');
    assert.equal(resolveHref('plates/patton', at('')).target, 'plates/patton/index.html');
});

test('an image is a link too', () => {
    assert.equal(resolveHref('../../assets/images/patton.jpg', at('plates/patton')).kind, 'internal');
});

test('a path climbing above the site root is broken, not resolved', () => {
    assert.equal(resolveHref('../../../etc/passwd', at('plates/patton')).why, 'climbs above the site root');
});

test('an empty href is broken rather than ignored', () => {
    for (const href of ['', '   ', undefined, null]) {
        assert.equal(resolveHref(href, at('')).kind, 'broken', JSON.stringify(href));
    }
});

// --- what the site publishes ----------------------------------------------

test('an underscore folder is in the repo and not on the site', () => {
    const pages = published(FILES);

    assert.ok(!pages.has('_legacy/SNAFU.html'));
    assert.ok(pages.has('$Pre-2010/11.26.10.html'));
});

test('linking into _legacy is broken, and says so in its own words', () => {
    // This is the failure the _legacy folder invites: the file is right
    // there on disk, `git` is happy, and the live site answers 404.
    const found = resolveHref('_legacy/SNAFU.html', at(''));

    assert.equal(found.kind, 'broken');
    assert.equal(found.why, UNPUBLISHED);
});

// --- the site itself ------------------------------------------------------

test('the machinery is not mistaken for the site', async () => {
    const files = await listFiles(REPO_ROOT);

    for (const dir of ['scripts/', 'templates/', 'docs/', 'node_modules/', '.github/']) {
        assert.ok(!files.some((f) => f.startsWith(dir)), `${dir} was walked`);
    }
    assert.ok(files.includes('index.html'));
});

test('every link on the published site resolves', async () => {
    // The one that earns its keep. If this fails, the named page has a
    // link a reader would follow into a 404 - fix the href, or move the
    // target back where the site can see it.
    const { pages, broken } = await sweep(REPO_ROOT);

    assert.ok(pages.length > 100, `only ${pages.length} pages found - did the walk break?`);
    assert.deepEqual(
        broken.map((b) => `${b.from} -> "${b.href}" (${b.why})`),
        []
    );
});

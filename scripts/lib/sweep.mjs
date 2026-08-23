// Walks the published site and resolves every link on it the way the
// live server would, so a link that 404s in the browser fails a test
// here instead.
//
// This is what is left of graph.html. That page drew a map of the
// collection and, incidentally, listed the links that did not resolve -
// a report nobody read on a page nobody visited. The Commonplace Book
// draws the map now, so only the sweep remains, and it lives where a
// broken link is loud: the test suite.
//
// "The way the live server would" is the whole point. GitHub Pages
// matches paths exactly, one byte at a time; it does not forgive a
// capital letter or a curly quote, and it does not publish a directory
// whose name begins with an underscore. So neither does this.

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';

// Directories that hold machinery rather than pages.
const SKIP_DIRS = new Set(['.git', '.github', 'node_modules', 'templates', 'scripts', 'docs']);

const SITE_ORIGIN = /^https?:\/\/manonthesea\.github\.io\/you-hear-me\/(.*)$/i;

// Reasons a link does not resolve. Kept apart because they call for
// different fixes: a typo is corrected, an unpublished target is either
// moved back out of its underscore folder or stopped being linked to.
export const MISSING = 'no such page';
export const UNPUBLISHED = 'exists in the repo, but Jekyll does not publish it';

/** Every file under `root`, as repo-relative POSIX paths. */
export async function listFiles(root, dir = '') {
    const entries = await readdir(path.join(root, dir), { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const rel = dir ? path.posix.join(dir, entry.name) : entry.name;
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue;
            files.push(...(await listFiles(root, rel)));
        } else if (entry.isFile()) {
            files.push(rel);
        }
    }
    return files;
}

/** Of those files, the ones GitHub Pages actually serves. */
export function published(files) {
    // Jekyll skips any path segment beginning with an underscore, which
    // is what _legacy/ relies on to keep the hand-made pages off the
    // site while leaving them in the repo.
    return new Set(files.filter((f) => !f.split('/').some((seg) => seg.startsWith('_'))));
}

/**
 * Where a single href points, judged against the set of published paths.
 *
 * Returns `{ kind }` where kind is one of: `internal` (with `target`),
 * `external`, `skip`, or `broken` (with `why`).
 */
export function resolveHref(href, { fromDir = '', pages, files = pages } = {}) {
    if (href === undefined || href === null || !href.trim()) {
        return { kind: 'broken', why: 'the href is empty' };
    }

    let raw = href.trim();
    if (/^(mailto:|tel:|javascript:|data:|#)/i.test(raw)) return { kind: 'skip' };

    // An absolute link back to our own site is an internal link wearing
    // a hostname, and it can 404 just as easily.
    const ours = raw.match(SITE_ORIGIN);
    if (ours) raw = ours[1];
    else if (/^(https?:)?\/\//i.test(raw)) return { kind: 'external' };

    let decoded;
    try {
        decoded = decodeURIComponent(raw);
    } catch {
        // A stray "%" that is not an escape. The server will not decode
        // it either, so judge it as it is written.
        decoded = raw;
    }
    decoded = decoded.split('#')[0].split('?')[0];
    if (!decoded) return { kind: 'skip' }; // a bare "#fragment" or "?query"

    const target = path.posix.normalize(fromDir ? path.posix.join(fromDir, decoded) : decoded);
    if (target.startsWith('..')) return { kind: 'broken', why: 'climbs above the site root' };

    // GitHub Pages serves "foo.html" for a request for "foo".
    const candidates = target.endsWith('/')
        ? [`${target}index.html`]
        : [target, `${target}.html`, `${target}/index.html`];

    for (const candidate of candidates) {
        if (pages.has(candidate)) return { kind: 'internal', target: candidate };
    }
    for (const candidate of candidates) {
        if (files.has(candidate)) return { kind: 'broken', why: UNPUBLISHED, target: candidate };
    }
    return { kind: 'broken', why: MISSING };
}

/**
 * Resolve every link on every published page under `root`.
 *
 * Returns `{ pages, links, external, broken }`, where `broken` is a list
 * of `{ from, href, why }` - enough to fix it without opening the page.
 */
export async function sweep(root) {
    const all = await listFiles(root);
    const files = new Set(all);
    const pages = published(all);
    const htmlPages = [...pages].filter((f) => f.toLowerCase().endsWith('.html')).sort();

    const broken = [];
    let links = 0;
    let external = 0;

    for (const page of htmlPages) {
        const $ = cheerio.load(await readFile(path.join(root, page), 'utf8'));
        const fromDir = path.posix.dirname(page) === '.' ? '' : path.posix.dirname(page);

        // href carries the links a reader follows; src carries the ones
        // the browser follows on its own - a missing image is just as
        // broken, and quieter.
        for (const el of $('a[href], img[src], iframe[src], link[href], script[src]').toArray()) {
            const href = $(el).attr('href') ?? $(el).attr('src');
            const found = resolveHref(href, { fromDir, pages, files });
            if (found.kind === 'internal') links += 1;
            else if (found.kind === 'external') external += 1;
            else if (found.kind === 'broken') broken.push({ from: page, href, why: found.why });
        }
    }

    return { pages: htmlPages, links, external, broken };
}

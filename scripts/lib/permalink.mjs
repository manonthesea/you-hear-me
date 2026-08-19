// Stable public URLs for poems, derived from the Drive Doc ID.
//
// A poem's pretty path comes from its Doc's name, so it changes whenever
// the Doc is renamed, retitled or moved - and it has, more than twenty
// times, silently killing every link anyone had shared. The Doc ID is
// the one identifier that survives all of that, so it is what a
// permanent URL is built from.
//
// The permalink is an ADDITION, never a replacement: the poem keeps its
// readable path, and "p/<id>/" is a second address that redirects to
// wherever the poem currently lives.
//
// The raw Doc ID is deliberately not used as the URL. The repo is
// public and Drive identifiers do not belong on public pages (the same
// rule that stops an unpublished poem's docs.google.com URL being
// written into a page). Hashing keeps the identifier private while
// staying a pure function of it - so no registry file has to be
// maintained, and the same Doc always produces the same URL.

import { createHash } from 'node:crypto';
import path from 'node:path';
import { escapeHtml } from './render.mjs';

// Where permalinks live. A directory rather than "<id>.html" so the URL
// is "/p/<id>/" with nothing to read past the identifier.
const PERMALINK_DIR = 'p';

// 40 bits of SHA-256, in base36. Eight lowercase alphanumerics: short
// enough to paste into a message, and roughly a trillion values against
// a collection of a few hundred poems, so a collision is vanishingly
// unlikely - and checked for anyway, because "unlikely" is not "cannot".
const ID_BITS_AS_HEX = 10;
const ID_LENGTH = 8;

/**
 * The permanent identifier for a poem.
 *
 * This value is a PUBLISHED URL. Changing how it is derived breaks every
 * link anyone has already shared, so it is pinned by a test with a
 * literal expected value rather than a recomputation.
 *
 * @param {string} docId - the Drive file ID of the poem's Doc.
 * @returns {string} eight lowercase alphanumerics.
 */
export function permalinkId(docId) {
    const digest = createHash('sha256').update(String(docId), 'utf8').digest('hex');
    const value = BigInt(`0x${digest.slice(0, ID_BITS_AS_HEX)}`);
    return value.toString(36).padStart(ID_LENGTH, '0');
}

/**
 * @param {string} id - from permalinkId.
 * @returns {string} repo-relative path of the permalink page.
 */
export function permalinkPath(id) {
    return path.posix.join(PERMALINK_DIR, id, 'index.html');
}

/**
 * Two poems resolving to one permalink would mean one of them is
 * unreachable by its permanent URL, and which one won would depend on
 * write order. Refuse to publish rather than pick.
 *
 * @param {Array<{ id: string, filePath: string }>} entries - Doc IDs and their pages.
 * @returns {Array<{ permalink: string, filePaths: string[] }>} collisions, empty if none.
 */
export function findPermalinkCollisions(entries) {
    const byId = new Map();
    for (const entry of entries) {
        const id = permalinkId(entry.id);
        const list = byId.get(id) ?? [];
        list.push(entry.filePath);
        byId.set(id, list);
    }
    return [...byId.entries()]
        .filter(([, filePaths]) => filePaths.length > 1)
        .map(([permalink, filePaths]) => ({ permalink, filePaths }));
}

// The same path needs THREE different encodings, and the folders in this
// repo exercise all of them: "1. Winter" has a space, "2018-2019&" has
// an ampersand.
//
//   percent-encoding  - for the space, in every context.
//   HTML escaping     - inside an attribute value, where the browser
//                       decodes "&amp;" back to "&".
//   JS string escaping - inside <script>, where it does NOT. Script
//                       content is raw text, so an HTML-escaped path
//                       reaches location.replace() with a literal
//                       "&amp;" in it and navigates to a page that does
//                       not exist. Confirmed in a browser, not guessed.
//
// Both forms are derived from one encoded path so they cannot drift.
function hrefForms(fromDir, toPath) {
    const encoded = encodeURI(path.posix.relative(fromDir, toPath));
    return {
        attr: escapeHtml(encoded),
        // JSON.stringify produces a correctly quoted JS string literal;
        // encodeURI has already turned "<" into %3C, so there is nothing
        // left that could close the script element early.
        js: JSON.stringify(encoded),
    };
}

/**
 * The permalink page itself: a redirect to the poem's current location.
 *
 * Three routes, because a reader may have scripting disabled and a
 * crawler may follow none of them: location.replace (leaves no history
 * entry, so Back does not bounce), a meta refresh, and a visible link.
 * rel=canonical keeps the readable path as the indexed one.
 *
 * @param {{ id: string, title: string, filePath: string }} poem
 * @returns {string} the finished page.
 */
export function renderPermalink({ id, title, filePath }) {
    const { attr: href, js } = hrefForms(
        path.posix.dirname(permalinkPath(permalinkId(id))),
        filePath
    );
    const safeTitle = escapeHtml(title);
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${safeTitle}</title>
    <meta name="robots" content="noindex,follow">
    <link rel="canonical" href="${href}">
    <meta http-equiv="refresh" content="0;url=${href}">
    <script>location.replace(${js});</script>
</head>
<body>
    <p>If you are not redirected, <a href="${href}">${safeTitle}</a>.</p>
</body>
</html>
`;
}

// A plate: one image, alone on a black page, that can be clicked.
//
// An image linked from a poem used to be the raw file, so the reader
// landed on a bare JPEG with nowhere to go but the Back button, and
// there was no HTML to hang anything on. A plate is a page we own, so
// the image can carry behaviour - a way back, an overlay that leads
// somewhere else, and later whatever a particular image needs.
//
// The default action is to return the reader where they came from. That
// is done twice over on purpose: a static link to the poem that
// references the image, so it works with no scripting at all, and a
// same-origin referrer check that overrides it when the reader arrived
// from somewhere else on the site. An off-site referrer is ignored -
// the way back should never leave the collection.

import path from 'node:path';
import { escapeHtml } from './render.mjs';

const PLATE_DIR = 'plates';

/**
 * A readable directory name for an image.
 *
 * Derived from the filename, so it stays predictable, but sanitized:
 * several of these images are camera exports with names like
 * "E9E151FD-4C88-49A7-A860-780A8DE38977.jpeg".
 *
 * @param {string} assetPath - repo-relative path of the image.
 * @returns {string}
 */
export function plateSlug(assetPath) {
    const base = path.posix.basename(assetPath, path.posix.extname(assetPath));
    return (
        base
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 48) || 'plate'
    );
}

/**
 * @param {string} slug - from plateSlug.
 * @returns {string} repo-relative path of the plate page.
 */
export function platePath(slug) {
    return path.posix.join(PLATE_DIR, slug, 'index.html');
}

// Two encodings, as everywhere else in this repo: percent-encoding for
// the spaces in "1. Winter", HTML escaping for the "&" in "2018-2019&".
function attrHref(fromDir, toPath) {
    return escapeHtml(encodeURI(path.posix.relative(fromDir, toPath)));
}

/**
 * The plate page.
 *
 * @param {{
 *   asset: string,            // repo-relative path of the image
 *   title: string,            // used for the page title and alt text
 *   back: string|null,        // repo-relative page the image click leads to
 *   pinned?: boolean,         // true when that destination was chosen, not inferred
 *   zoom?: number|null,       // magnification, 1 being fit-to-screen
 *   scroll?: number|null,     // 0..1, how far down to open the view
 *   overlay?: { image: string, href: string, alt: string } | null,
 * }} plate
 * @returns {string} the finished page.
 */
export function renderPlate({
    asset,
    title,
    back,
    pinned = false,
    zoom = null,
    scroll = null,
    overlay = null,
}) {
    const dir = path.posix.dirname(platePath(plateSlug(asset)));
    const src = attrHref(dir, asset);
    const safeTitle = escapeHtml(title);
    const backHref = back ? attrHref(dir, back) : attrHref(dir, 'index.html');

    // A zoomed plate is a detail view: the image is drawn larger than the
    // screen and the page scrolls, rather than being fitted into it.
    const zoomed = typeof zoom === 'number' && zoom > 1;
    const overlayHtml = overlay
        ? `
    <a class="overlay" href="${attrHref(dir, overlay.href)}" aria-label="${escapeHtml(overlay.alt)}">
        <img src="${attrHref(dir, overlay.image)}" alt="${escapeHtml(overlay.alt)}">
    </a>`
        : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${safeTitle}</title>
    <style>
        /* Black, edge to edge: the image is the whole page. */
        html, body { height: 100%; }
        body {
            margin: 0;
            background: #000;
            display: flex;
            align-items: center;
            justify-content: center;
            /* The overlay is positioned against this. */
            position: relative;
            overflow: hidden;
        }
        .plate {
            display: block;
            max-width: 100%;
            max-height: 100%;
        }
        .plate img {
            display: block;
            max-width: 100vw;
            max-height: 100vh;
            width: auto;
            height: auto;
        }
${zoomed ? `
        /* Zoomed: fill beyond the viewport and let the page scroll. */
        body { display: block; overflow: auto; }
        .plate, .plate img {
            max-width: none;
            max-height: none;
            width: calc(100vw * ${zoom});
            height: auto;
        }` : ''}
        /*
         * Off-centre right, and sized against the viewport so it holds
         * its proportion on a phone as well as a desktop.
         */
        .overlay {
            position: absolute;
            top: 50%;
            right: 8vw;
            transform: translateY(-50%);
            width: min(28vw, 30vh);
        }
        .overlay img { display: block; width: 100%; height: auto; }
        .overlay:focus-visible, .plate:focus-visible { outline: 2px solid #58a6ff; }
    </style>
</head>
<body>
    <a class="plate" id="back" href="${backHref}">
        <img src="${src}" alt="${safeTitle}">
    </a>${overlayHtml}
    <script>
${pinned ? `        // This plate's destination was chosen deliberately, so the
        // referrer must not override it.` : `        // Prefer wherever the reader actually came from, but only within
        // this site - an off-site referrer must not become the way back.
        try {
            const from = document.referrer;
            if (from && new URL(from).origin === location.origin
                && new URL(from).pathname !== location.pathname) {
                document.getElementById('back').href = from;
            }
        } catch (e) { /* keep the static fallback */ }`}
${zoomed && scroll !== null ? `        // Open part-way down the image rather than at its top edge, and
        // centred across, so the reader lands on the detail. Waiting for
        // the image keeps the measurement off a zero-height page.
        (function () {
            const image = document.querySelector('.plate img');
            const place = function () {
                const root = document.documentElement;
                window.scrollTo(
                    (root.scrollWidth - window.innerWidth) / 2,
                    (root.scrollHeight - window.innerHeight) * ${scroll}
                );
            };
            if (image.complete) place();
            else image.addEventListener('load', place);
        })();` : ''}
    </script>
</body>
</html>
`;
}

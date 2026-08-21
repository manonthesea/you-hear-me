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
 *   zoom?: number|null,       // magnification, 1 being no magnification
 *   zoomOn?: 'load'|'click',  // magnified from the outset, or on the first click
 *   focus?: number|null,      // 0..1 across, where the magnified view frames (zoomOn: click)
 *   scroll?: number|null,     // 0..1, how far down to open the view (zoomOn: load)
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
    zoomOn = 'load',
    focus = null,
    scroll = null,
    overlay = null,
}) {
    const dir = path.posix.dirname(platePath(plateSlug(asset)));
    const src = attrHref(dir, asset);
    const safeTitle = escapeHtml(title);
    const backHref = back ? attrHref(dir, back) : attrHref(dir, 'index.html');

    // Two ways to magnify, and they differ only in when it happens.
    //
    //   load  - the plate opens as a detail view: the image is drawn
    //           larger than the screen and the page scrolls.
    //   click - the plate opens whole, and the first click magnifies it
    //           around the spot the reader pointed at. The click after
    //           that follows the link.
    const magnifies = typeof zoom === 'number' && zoom > 1;
    const zoomOnClick = magnifies && zoomOn === 'click';
    const zoomOnLoad = magnifies && !zoomOnClick;

    // Across, the magnified view either follows the click like the
    // vertical does, or - when the picture has a subject that is not in
    // the middle - frames a fixed fraction of the width instead. Down it
    // always follows the click.
    const across =
        focus === null
            ? `                    // Across and down alike, the point clicked stays put.
                    left + fx * after.width - anchorX`
            : `                    // Across, the view is framed at ${focus} of the way over
                    // whatever the reader clicked, and centred on it. scrollTo
                    // clamps, so 0 simply rests against the left edge.
                    left + ${focus} * after.width - window.innerWidth / 2`;

    // Positioned against the image rather than the window, so the amount
    // of overlap stays the same whatever size the screen is. Percentages
    // are of the image's own width: right:0 sits the overlay flush inside
    // the right edge, a negative value hangs it off.
    const overlayWidth = overlay?.width ?? 34;
    const overlayRight = overlay?.right ?? 0;
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
        /*
         * Shrink-wraps the image, so anything positioned against it is
         * placed relative to the picture rather than the window.
         */
        .stage {
            position: relative;
            display: inline-block;
            line-height: 0;
            max-width: 100%;
            max-height: 100%;
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
${zoomOnLoad ? `
        /* Zoomed: fill beyond the viewport and let the page scroll. */
        body { display: block; overflow: auto; }
        .stage { max-width: none; max-height: none; }
        .plate, .plate img {
            max-width: none;
            max-height: none;
            width: calc(100vw * ${zoom});
            height: auto;
        }` : ''}
${zoomOnClick ? `
        /*
         * The magnified state, entered on the first click. The width
         * itself is set on the image by the script, from the size it was
         * actually being drawn at - the constraints are only released
         * here so that width can take effect and the page can scroll.
         */
        .plate { cursor: zoom-in; }
        body.zoomed { display: block; overflow: auto; }
        body.zoomed .stage { max-width: none; max-height: none; }
        body.zoomed .plate { cursor: pointer; }
        body.zoomed .plate, body.zoomed .plate img {
            max-width: none;
            max-height: none;
            height: auto;
        }` : ''}
        /*
         * Over the right-hand side of the picture. Both numbers are
         * percentages of the image's width, so the composition holds on a
         * phone as well as a desktop.
         */
        .overlay {
            position: absolute;
            top: 50%;
            right: ${overlayRight}%;
            transform: translateY(-50%);
            width: ${overlayWidth}%;
        }
        .overlay img { display: block; width: 100%; height: auto; }
        .overlay:focus-visible, .plate:focus-visible { outline: 2px solid #58a6ff; }
    </style>
</head>
<body>
    <div class="stage">
        <a class="plate" id="back" href="${backHref}">
            <img src="${src}" alt="${safeTitle}">
        </a>${overlayHtml}
    </div>
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
${zoomOnLoad && scroll !== null ? `        // Open part-way down the image rather than at its top edge, and
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
${zoomOnClick ? `        // Click once to magnify, again to follow the link.
        //
        // The href is left exactly as it is, so a reader with no
        // scripting simply arrives at the destination on the first click.
        // The zoom is an addition to the page, never a gate across it.
        (function () {
            const plate = document.getElementById('back');
            const image = plate.querySelector('img');
            let magnified = false;

            plate.addEventListener('click', function (event) {
                if (magnified) return;   // this one travels
                event.preventDefault();

                // Where in the picture the reader pointed, as a fraction
                // of it. A keyboard press carries no coordinates, so it
                // magnifies about the middle instead.
                const keyboard = event.detail === 0;
                const before = image.getBoundingClientRect();
                if (!before.width || !before.height) return;
                const anchorX = keyboard ? window.innerWidth / 2 : event.clientX;
                const anchorY = keyboard ? window.innerHeight / 2 : event.clientY;
                const fx = keyboard ? 0.5 : (anchorX - before.left) / before.width;
                const fy = keyboard ? 0.5 : (anchorY - before.top) / before.height;

                // Magnified against the size it was actually drawn at, so
                // "${zoom}" means ${zoom} times bigger than what the reader was
                // just looking at, whatever the screen.
                image.style.width = before.width * ${zoom} + 'px';
                document.body.classList.add('zoomed');
                magnified = true;

                const after = image.getBoundingClientRect();
                const left = after.left + window.scrollX;
                const top = after.top + window.scrollY;
                window.scrollTo(
${across},
                    top + fy * after.height - anchorY
                );
            });
        })();` : ''}
    </script>
</body>
</html>
`;
}

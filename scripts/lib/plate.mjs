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

// Enough for a modern page to draw itself - a map will not render at all
// without scripts - while still withholding allow-top-navigation, so a
// framed site cannot take the reader's tab out from under them.
const SANDBOX = 'allow-scripts allow-same-origin allow-popups';

// Just the host, for the escape hatch's label: "open en.wikipedia.org".
function hostOf(url) {
    try {
        return new URL(url).host;
    } catch {
        return 'the page';
    }
}

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
 *   overlay?: Overlay | Overlay[] | null,   // buttons over the picture, where
 *                              // Overlay is { image, href, alt, width?, left?,
 *                              // right?, top?, bottom?, bounce? }
 *   embed?: { src: string, frame: 'iframe'|'image', cover?: boolean } | null,
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
    embed = null,
}) {
    const dir = path.posix.dirname(platePath(plateSlug(asset)));
    const src = embed ? escapeHtml(embed.src) : attrHref(dir, asset);
    const framed = embed?.frame === 'iframe';
    // Clicking anywhere returns the reader, as on an image plate. Turned
    // off for a frame whose contents are meant to be read or used: a
    // cover over a Wikipedia article is an article nobody can scroll.
    const covered = framed && embed.cover !== false;
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

    // Buttons over the picture. Positioned against the image rather than
    // the window, so the amount of overlap stays the same whatever size
    // the screen is: across, percentages are of the image's own width,
    // and down, of its height. right:0 sits a button flush inside the
    // right edge; a negative value hangs it off.
    //
    // A single mapping is still accepted, so a plate with one button
    // reads the way it always did.
    const overlays = overlay === null ? [] : Array.isArray(overlay) ? overlay : [overlay];
    const overlayHtml = overlays
        .map(
            (one, i) => `
        <a class="overlay overlay-${i + 1}" href="${attrHref(dir, one.href)}" aria-label="${escapeHtml(one.alt)}">
            <img src="${attrHref(dir, one.image)}" alt="${escapeHtml(one.alt)}">
        </a>`,
        )
        .join('');

    // Each button's own placement. Given neither edge, it sits against
    // the right and centred down the picture - where the only button
    // there has ever been sits, so nothing already written moves.
    const overlayCss = overlays
        .map((one, i) => {
            const rules = [`width: ${one.width ?? 34}%;`];
            if (one.left !== undefined) rules.push(`left: ${one.left}%;`);
            else rules.push(`right: ${one.right ?? 0}%;`);
            if (one.top !== undefined) rules.push(`top: ${one.top}%;`);
            else if (one.bottom !== undefined) rules.push(`bottom: ${one.bottom}%;`);
            else rules.push('top: 50%;', 'transform: translateY(-50%);');
            // The bob is on the picture inside the link, not on the link
            // itself, so it cannot fight the transform that centres it.
            const bob = one.bounce
                ? `\n        .overlay-${i + 1} img { animation: bob ${one.bounce}s ease-in-out infinite; }`
                : '';
            return `        .overlay-${i + 1} { ${rules.join(' ')} }${bob}`;
        })
        .join('\n');

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
${framed ? `
        /*
         * A picture on someone else's server, in a frame. Full bleed,
         * because its proportions are not knowable from here - there is
         * nothing to shrink-wrap the way a local image is shrink-wrapped.
         */
        .stage { position: absolute; inset: 0; max-width: none; max-height: none; }
        .embed { display: block; width: 100%; height: 100%; border: 0; }
        /*
         * The whole surface is the button. A click inside a cross-origin
         * frame never reaches this page, so the link cannot wrap the frame
         * the way it wraps an image - it has to lie on top of it.
         */
        .cover { position: absolute; inset: 0; display: block; cursor: pointer; }
        .cover:focus-visible { outline: 2px solid #58a6ff; outline-offset: -4px; }
        /*
         * Above the cover, so it stays clickable, and there whether or
         * not the frame loaded. A site that refuses to be framed renders
         * nothing at all inside one, and without this the plate would be
         * a blank page with no way onward.
         */
        .ways {
            position: absolute;
            right: 0;
            bottom: 0;
            z-index: 2;
            display: flex;
            gap: 1rem;
            padding: 0.5rem 0.9rem;
            font: 12px/1.4 ui-monospace, 'SF Mono', Menlo, monospace;
            background: rgba(0, 0, 0, 0.72);
            border-top-left-radius: 6px;
        }
        .ways a { color: #9aa4b2; text-decoration: none; white-space: nowrap; }
        .ways a:hover, .ways a:focus-visible { color: #e6edf3; text-decoration: underline; }` : ''}
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
        .overlay { position: absolute; }
        .overlay img { display: block; width: 100%; height: auto; }
        .overlay:focus-visible, .plate:focus-visible { outline: 2px solid #58a6ff; }
${overlayCss}
        /* Percentages here are of the button's own height, so a small
           button bobs a small distance and the motion reads the same at
           every size. */
        @keyframes bob {
            from, to { transform: translateY(0); }
            50% { transform: translateY(-9%); }
        }
        @media (prefers-reduced-motion: reduce) {
            .overlay img { animation: none; }
        }
    </style>
</head>
<body>
    <div class="stage">
${framed ? `        <iframe class="embed" src="${src}" title="${safeTitle}"
                referrerpolicy="no-referrer" sandbox="${SANDBOX}" loading="lazy"></iframe>
${covered ? `        <a class="cover" id="back" href="${backHref}" aria-label="Back"></a>` : ''}
        <p class="ways">
${covered ? '' : `            <a id="back" href="${backHref}">&larr; back</a>`}
            <a href="${src}" target="_blank" rel="noopener noreferrer">open ${escapeHtml(hostOf(embed.src))} &#8599;</a>
        </p>` : `        <a class="plate" id="back" href="${backHref}">
            <img src="${src}" alt="${safeTitle}"${embed ? ' referrerpolicy="no-referrer"' : ''}>
        </a>`}${overlayHtml}
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

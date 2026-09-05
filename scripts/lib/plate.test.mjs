// Tests for the plate: an image alone on a black page, clickable.
//
// Before plates, a link to an image landed the reader on a bare JPEG
// with nowhere to go and no HTML to hang anything on.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { plateSlug, platePath, renderPlate } from './plate.mjs';

const ASSET = 'scan0005.jpg';
const plate = (over = {}) =>
    renderPlate({ asset: ASSET, title: 'Black Mud Sound', back: '$Pre-2010/Circa 2010.html', ...over });

test('a plate lives in a readable directory named for its image', () => {
    assert.equal(plateSlug('scan0005.jpg'), 'scan0005');
    assert.equal(platePath('scan0005'), 'plates/scan0005/index.html');
});

test('a camera export name is sanitized into something addressable', () => {
    assert.equal(plateSlug('E9E151FD-4C88-49A7-A860-780A8DE38977.jpeg'), 'e9e151fd-4c88-49a7-a860-780a8de38977');
});

test('the page is black and shows the image', () => {
    const page = plate();

    assert.match(page, /background:\s*#000/);
    assert.match(page, /<img src="\.\.\/\.\.\/scan0005\.jpg"/);
});

test('clicking the image returns to the poem, with no scripting needed', () => {
    // The static href is the fallback that works everywhere; the script
    // only refines it.
    const page = plate();

    assert.match(page, /<a class="plate" id="back" href="\.\.\/\.\.\/\$Pre-2010\/Circa%202010\.html">/);
});

test('an off-site referrer is never used as the way back', () => {
    const page = plate();

    assert.match(page, /origin === location\.origin/);
});

test('a plate with no overlay has no overlay markup', () => {
    assert.doesNotMatch(plate(), /class="overlay"/);
});

test('an overlay is a second, separate click target', () => {
    const page = plate({
        overlay: { image: 'Yeats.png', href: 'index.html', alt: 'Yeats' },
    });

    assert.match(page, /<a class="overlay overlay-1" href="\.\.\/\.\.\/index\.html"/);
    assert.match(page, /<img src="\.\.\/\.\.\/Yeats\.png" alt="Yeats">/);
    // and the image underneath still goes back
    assert.match(page, /<a class="plate" id="back"/);
});

test('an overlay sits off-centre right, and centred down, by default', () => {
    const page = plate({ overlay: { image: 'Yeats.png', href: 'index.html', alt: 'Yeats' } });

    assert.match(page, /\.overlay-1\s*\{[^}]*right: 0%;/s);
    assert.match(page, /\.overlay-1\s*\{[^}]*top: 50%;[^}]*translateY\(-50%\)/s);
});

test('a plate can carry several buttons, each with its own destination', () => {
    const page = plate({
        overlay: [
            { image: 'Yeats.png', href: 'index.html', alt: 'Yeats' },
            { image: 'rabbit.png', href: '$Pre-2010/4.27.9.html', alt: 'A hare' },
        ],
    });

    assert.match(page, /<a class="overlay overlay-1" href="\.\.\/\.\.\/index\.html"/);
    assert.match(page, /<a class="overlay overlay-2" href="\.\.\/\.\.\/\$Pre-2010\/4\.27\.9\.html"/);
    assert.match(page, /alt="A hare"/);
});

test('a button is placed by whichever edges it names', () => {
    const page = plate({
        overlay: [{ image: 'rabbit.png', href: 'index.html', alt: 'A hare', width: 12, left: 40, top: 30 }],
    });

    assert.match(page, /\.overlay-1\s*\{[^}]*width: 12%;/s);
    assert.match(page, /\.overlay-1\s*\{[^}]*left: 40%;/s);
    assert.match(page, /\.overlay-1\s*\{[^}]*top: 30%;/s);
    // placed down the picture itself, so it is not also being centred
    assert.doesNotMatch(page, /\.overlay-1\s*\{[^}]*translateY/s);
});

test('a button bobs only when it is told to, and never against the reader', () => {
    const still = plate({ overlay: [{ image: 'rabbit.png', href: 'index.html', alt: 'A hare' }] });
    assert.doesNotMatch(still, /animation: bob/);

    const bobbing = plate({
        overlay: [{ image: 'rabbit.png', href: 'index.html', alt: 'A hare', bounce: 2.4 }],
    });
    // on the picture inside the link, so it cannot fight the placement
    assert.match(bobbing, /\.overlay-1 img \{ animation: bob 2\.4s ease-in-out infinite; \}/);
    assert.match(bobbing, /@media \(prefers-reduced-motion: reduce\) \{\s*\.overlay img \{ animation: none; \}/s);
});

test('a title with markup characters cannot break out', () => {
    const page = renderPlate({ asset: ASSET, title: 'A & <b>', back: null });

    assert.match(page, /<title>A &amp; &lt;b&gt;<\/title>/);
});

// --- zoom, scroll, and a pinned destination -----------------------------

const zoomPlate = (over = {}) =>
    renderPlate({
        asset: 'patton-pissing.jpg',
        title: 'Patton on the Rhine',
        back: '$Pre-2010/11.26.10.html',
        pinned: true,
        zoom: 3,
        scroll: 0.75,
        ...over,
    });

test('a zoomed plate draws the image larger than the screen and scrolls', () => {
    const page = zoomPlate();

    assert.match(page, /width: calc\(100vw \* 3\)/);
    assert.match(page, /body \{ display: block; overflow: auto; \}/);
});

test('a zoomed plate opens part-way down, and centred across', () => {
    const page = zoomPlate();

    assert.match(page, /scrollHeight - window\.innerHeight\) \* 0\.75/);
    assert.match(page, /scrollWidth - window\.innerWidth\) \/ 2/);
});

test('placement waits for the image, so it never measures a bare page', () => {
    const page = zoomPlate();

    assert.match(page, /image\.complete/);
    assert.match(page, /addEventListener\('load', place\)/);
});

test('a pinned destination is not overridden by the referrer', () => {
    // The default plate follows the reader back; this one always leads
    // where it was told to.
    const page = zoomPlate();

    assert.doesNotMatch(page, /document\.referrer/);
    assert.match(page, /href="\.\.\/\.\.\/\$Pre-2010\/11\.26\.10\.html"/);
});

test('an unpinned plate still follows the reader back', () => {
    const page = renderPlate({ asset: 'scan0005.jpg', title: 'x', back: 'a.html' });

    assert.match(page, /document\.referrer/);
});

test('zoom of 1 or less leaves the plate fitted to the screen', () => {
    for (const zoom of [null, 1, 0.5]) {
        const page = renderPlate({ asset: 'a.jpg', title: 'x', back: 'b.html', zoom, scroll: 0.5 });
        assert.doesNotMatch(page, /calc\(100vw \*/, `zoom ${zoom} should not magnify`);
    }
});

// --- click once to magnify, again to travel -----------------------------

const clickZoom = (over = {}) =>
    renderPlate({
        asset: 'patton-pissing.jpg',
        title: 'Patton on the Rhine',
        back: '$Pre-2010/11.26.10.html',
        pinned: true,
        zoom: 3,
        zoomOn: 'click',
        ...over,
    });

test('a click-to-zoom plate opens unmagnified', () => {
    // The whole point is that the reader sees the picture entire first.
    // Emitting the load-time magnification rules would defeat it.
    const page = clickZoom();

    assert.doesNotMatch(page, /^\s*body \{ display: block; overflow: auto; \}/m);
    assert.doesNotMatch(page, /calc\(100vw \*/);
});

test('the magnified state is a class the first click adds', () => {
    const page = clickZoom();

    assert.match(page, /body\.zoomed \{ display: block; overflow: auto; \}/);
    assert.match(page, /classList\.add\('zoomed'\)/);
});

test('the first click is stopped and the second is let through', () => {
    // Without the guard the reader would leave the page before ever
    // seeing it magnified.
    const page = clickZoom();

    assert.match(page, /if \(magnified\) return;/);
    assert.match(page, /event\.preventDefault\(\)/);
});

test('the link itself is untouched, so no scripting still travels', () => {
    // The zoom is an addition to the page, never a gate across it.
    const page = clickZoom();

    assert.match(page, /<a class="plate" id="back" href="\.\.\/\.\.\/\$Pre-2010\/11\.26\.10\.html">/);
});

test('magnification is measured against the size the image was drawn at', () => {
    // Not against the viewport: this plate opens fitted, so "3" has to
    // mean three times what the reader was just looking at.
    const page = clickZoom();

    assert.match(page, /before\.width \* 3 \+ 'px'/);
});

test('the clicked point of the picture stays under the cursor', () => {
    const page = clickZoom();

    assert.match(page, /fx = keyboard \? 0\.5 : \(anchorX - before\.left\) \/ before\.width/);
    assert.match(page, /const left = after\.left \+ window\.scrollX/);
    assert.match(page, /left \+ fx \* after\.width - anchorX/);
});

test('a keyboard press magnifies about the middle', () => {
    // event.detail is 0 for Enter on a link, and clientX/Y are 0 with it -
    // taken literally that would jump to the top-left corner.
    const page = clickZoom();

    assert.match(page, /keyboard = event\.detail === 0/);
    assert.match(page, /window\.innerWidth \/ 2/);
});

test('the cursor says which of the two clicks this is', () => {
    const page = clickZoom();

    assert.match(page, /\.plate \{ cursor: zoom-in; \}/);
    assert.match(page, /body\.zoomed \.plate \{ cursor: pointer; \}/);
});

test('a plate with no zoom carries no click-to-zoom script at all', () => {
    const page = plate();

    assert.doesNotMatch(page, /classList\.add\('zoomed'\)/);
    assert.doesNotMatch(page, /cursor: zoom-in/);
});

test('zoomOn: click with a zoom of 1 or less stays fitted and inert', () => {
    for (const zoom of [null, 1, 0.5]) {
        const page = clickZoom({ zoom });
        assert.doesNotMatch(page, /classList\.add\('zoomed'\)/, `zoom ${zoom} should not magnify`);
    }
});

test('load-time zoom is unaffected by the new option', () => {
    const page = zoomPlate();

    assert.match(page, /width: calc\(100vw \* 3\)/);
    assert.doesNotMatch(page, /classList\.add\('zoomed'\)/);
});

// --- framing the magnified view across the picture ----------------------

test('with no focus, the view follows the click across as well as down', () => {
    const page = clickZoom();

    assert.match(page, /left \+ fx \* after\.width - anchorX/);
    assert.doesNotMatch(page, /window\.innerWidth \/ 2\n/);
});

test('a focus frames a fixed fraction across, ignoring where the click landed', () => {
    // Patton stands on the left of his photograph; the reader clicking
    // the right of the frame should still be shown him.
    const page = clickZoom({ focus: 0 });

    assert.match(page, /left \+ 0 \* after\.width - window\.innerWidth \/ 2/);
    assert.doesNotMatch(page, /left \+ fx \* after\.width - anchorX/);
});

test('focus leaves the vertical alone - down still follows the click', () => {
    const page = clickZoom({ focus: 0 });

    assert.match(page, /top \+ fy \* after\.height - anchorY/);
});

test('a focus part-way across is placed at the middle of the screen', () => {
    const page = clickZoom({ focus: 0.75 });

    assert.match(page, /left \+ 0\.75 \* after\.width - window\.innerWidth \/ 2/);
});

// --- a picture on someone else's server ---------------------------------

const embedPlate = (over = {}) =>
    renderPlate({
        asset: 'tomb-of-the-wrestlers',
        title: 'The Tomb of the Wrestlers',
        back: '$Pre-2010/Circa 2003.html',
        pinned: true,
        embed: { src: 'https://example.org/a b.jpg?x=1&y=2', frame: 'iframe' },
        ...over,
    });

test('a framed embed puts the remote URL in an iframe', () => {
    const page = embedPlate();

    assert.match(page, /<iframe class="embed" src="https:\/\/example\.org\/a b\.jpg\?x=1&amp;y=2"/);
    assert.doesNotMatch(page, /<img src="https/);
});

test('the URL is escaped but not re-encoded', () => {
    // It may already carry percent escapes of its own; encoding again
    // would double them and fetch a URL nobody published.
    const page = embedPlate({ embed: { src: 'https://e.org/a%20b.jpg', frame: 'iframe' } });

    assert.match(page, /src="https:\/\/e\.org\/a%20b\.jpg"/);
});

test('the click target lies on top of the frame, not around it', () => {
    // A click inside a cross-origin frame never reaches this page, so a
    // link wrapping the iframe would simply never fire. This is the
    // whole reason the markup differs from an image plate.
    const page = embedPlate();

    assert.match(page, /<a class="cover" id="back" href="\.\.\/\.\.\/\$Pre-2010\/Circa%20\d+\.html"/);
    assert.match(page, /\.cover \{ position: absolute; inset: 0;/);
});

test('the cover is reachable and named for what it does', () => {
    // It has no text of its own - it is an empty box over a frame - and
    // what it does is go back, so that is what it should announce. It
    // used to announce the picture's title, which reads as a link to the
    // picture the reader is already looking at.
    const page = embedPlate();

    assert.match(page, /<a class="cover"[^>]*aria-label="Back"/);
    assert.match(page, /\.cover:focus-visible/);
});

test('third-party content is sandboxed and sent no referrer', () => {
    // sandbox with no allowances: the framed page cannot run scripts or
    // navigate this window. no-referrer both keeps the reader's page to
    // itself and gets past the commoner sort of hotlink check.
    const page = embedPlate();

    assert.match(page, /sandbox/);
    assert.match(page, /referrerpolicy="no-referrer"/);
});

test('a framed embed fills the page, having no size of its own to keep', () => {
    // A local image is shrink-wrapped by .stage; a cross-origin frame's
    // proportions cannot be measured from here, so there is nothing to
    // wrap.
    const page = embedPlate();

    assert.match(page, /\.stage \{ position: absolute; inset: 0;/);
    assert.match(page, /\.embed \{ display: block; width: 100%; height: 100%; border: 0; \}/);
});

test('frame: image draws the remote picture as an ordinary plate', () => {
    // Same page as a local image plate, only the src points elsewhere -
    // so it is centred on black at its own size, and X-Frame-Options
    // cannot refuse it.
    const page = embedPlate({ embed: { src: 'https://example.org/tomb.jpg', frame: 'image' } });

    assert.match(page, /<a class="plate" id="back"[^>]*>\s*<img src="https:\/\/example\.org\/tomb\.jpg"/);
    assert.doesNotMatch(page, /<iframe/);
});

test('an ordinary plate grows no iframe', () => {
    assert.doesNotMatch(plate(), /<iframe|class="cover"/);
});

test('an embed with no pinned destination follows the reader back', () => {
    // Same as an image plate: the static href names the poem that links
    // the picture, and the referrer check overrides it for a reader who
    // arrived from elsewhere on the site.
    const page = renderPlate({
        asset: 'empire-of-light',
        title: 'The Empire of Light',
        back: '$Pre-2010/Circa 2003.html',
        pinned: false,
        embed: { src: 'https://example.org/lamp.jpg', frame: 'image' },
    });

    assert.match(page, /document\.referrer/);
    assert.match(page, /href="\.\.\/\.\.\/\$Pre-2010\/Circa%20\d+\.html"/);
});

test('a remote picture is sent no referrer whichever way it is framed', () => {
    // Not only the iframe: an <img> hotlink leaks the reader's page in
    // the Referer header too, and the commoner hotlink checks read it.
    const page = renderPlate({
        asset: 'x',
        title: 'x',
        back: 'a.html',
        embed: { src: 'https://example.org/x.jpg', frame: 'image' },
    });

    assert.match(page, /<img src="https:\/\/example\.org\/x\.jpg"[^>]*referrerpolicy="no-referrer"/);
});

test('a local picture carries no referrer policy - there is nobody to withhold it from', () => {
    assert.doesNotMatch(plate(), /referrerpolicy/);
});

// --- a page in a frame, rather than a picture ----------------------------

const framedPage = (over = {}) =>
    renderPlate({
        asset: 'paul-fussell',
        title: 'Paul Fussell',
        back: '$Pre-2010/11.26.10.html',
        pinned: false,
        embed: { src: 'https://en.wikipedia.org/wiki/Paul_Fussell', frame: 'iframe', ...over },
    });

test('a framed page always offers a way out of the frame', () => {
    // A site that refuses to be framed renders nothing at all inside one.
    // Without this the plate is a black page with no way onward, which is
    // worse than the plain link it replaced.
    const page = framedPage();

    assert.match(page, /<a href="https:\/\/en\.wikipedia\.org\/wiki\/Paul_Fussell" target="_blank" rel="noopener noreferrer">/);
    assert.match(page, /open en\.wikipedia\.org/);
});

test('the way out sits above the cover, or it could never be clicked', () => {
    const page = framedPage();

    assert.match(page, /\.ways \{[^}]*z-index: 2/s);
});

test('the frame may run scripts but may not take the tab', () => {
    // A map does not draw at all without scripts. allow-top-navigation is
    // the one that would let a framed site replace the page around it.
    const page = framedPage();

    assert.match(page, /sandbox="allow-scripts allow-same-origin allow-popups"/);
    assert.doesNotMatch(page, /allow-top-navigation/);
});

test('cover: false leaves the page usable and shows a back link instead', () => {
    // A cover over an article is an article nobody can scroll.
    const covered = framedPage();
    const usable = framedPage({ cover: false });

    assert.match(covered, /<a class="cover"/);
    assert.doesNotMatch(usable, /<a class="cover"/);
    assert.match(usable, /<a id="back" href="[^"]*11\.26\.10\.html">&larr; back<\/a>/);
});

test('the cover and the back link lead to the same place', () => {
    const covered = framedPage();
    const usable = framedPage({ cover: false });
    const href = (p) => p.match(/id="back" href="([^"]+)"/)[1];

    assert.equal(href(covered), href(usable));
});

test('an image embed grows no frame furniture', () => {
    const page = renderPlate({
        asset: 'x', title: 'x', back: 'a.html',
        embed: { src: 'https://example.org/x.jpg', frame: 'image' },
    });

    assert.doesNotMatch(page, /<iframe|class="ways"|class="cover"/);
});

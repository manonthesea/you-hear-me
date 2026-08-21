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

    assert.match(page, /<a class="overlay" href="\.\.\/\.\.\/index\.html"/);
    assert.match(page, /<img src="\.\.\/\.\.\/Yeats\.png" alt="Yeats">/);
    // and the image underneath still goes back
    assert.match(page, /<a class="plate" id="back"/);
});

test('an overlay sits off-centre right', () => {
    const page = plate({ overlay: { image: 'Yeats.png', href: 'index.html', alt: 'Yeats' } });

    assert.match(page, /\.overlay\s*\{[^}]*right:/s);
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

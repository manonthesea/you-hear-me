// Tests for footnotes, block-level italics, and date-shape validation.
//
// All three came from the same source: the first real SNAFU sync. Its
// indented stanza is entirely italic (Google Docs put font-style on the
// paragraph itself, not an inner span), it has two footnote citations,
// and comparing against the hand-made page showed both silently
// disappearing. Date validation is a related fix in the same area: it
// stops a poem with no date-shaped last line from having that line
// swallowed into <em> as though it were one.
//
// The sections at the bottom come from the second round on the same
// poem, once its footnotes had been retyped as native Docs footnotes:
// the published page showed each citation truncated at its first line
// break (the quoted passage under it silently gone), and still no
// italics anywhere on the site - 0 of 41 generated pages carried a
// single .italic or .indent span, while everything not read from the
// export's stylesheet worked. So these fixtures deliberately model
// export shapes the earlier ones did not: multi-paragraph footnote
// bodies, and italics expressed as something other than one class on
// one span.

import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { convertDocHtml } from './convert.mjs';
import { renderPage } from './render.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, '..', '..', 'templates', 'poem-template.html');

function docExport(bodyHtml, extraCss = '') {
    return `<html><head><style type="text/css">
.c1{margin-left:36pt}
.c3{font-style:italic}
.c5{padding-top:0pt}
.c9{margin-left:216pt;font-style:italic}
${extraCss}
</style></head><body>${bodyHtml}</body></html>`;
}

const p = (inner, cls = 'c5') => `<p class="${cls}"><span>${inner}</span></p>`;
const blank = '<p class="c5"><span></span></p>';

// --- block-level italics ----------------------------------------------

test('a whole italic+indented line keeps its italics (font-style on the <p> itself)', () => {
    // The bug: Google Docs put font-style:italic on the SAME class as
    // the indent, on the paragraph, with no inner <span> to catch it -
    // the per-span check in renderSegments never saw it.
    const html = docExport([p('Mud knee deep in some places,', 'c9'), p('1.1.11')].join(''));
    const { body } = convertDocHtml(html, 'T', new Map());

    assert.equal(
        body,
        '<span class="line-number">1</span> ' +
            '<span class="fifth-indent"><span class="italic">Mud knee deep in some places,</span></span>'
    );
});

test('a block-italic line with a footnote reference inside stays italic', () => {
    const html = docExport(
        [
            '<p class="c9"><span>existing from moment to moment</span>' +
                '<a href="#ftnt2" id="ftnt_ref2"><span>[2]</span></a><span>,</span></p>',
            p('1.1.11'),
        ].join('')
    );
    const { body } = convertDocHtml(html, 'T', new Map());

    assert.match(
        body,
        /<span class="fifth-indent"><span class="italic">existing from moment to moment<sup class="footnote-number">2<\/sup>,<\/span><\/span>/
    );
});

test('a plain paragraph is not made italic by an unrelated class', () => {
    // isBlockItalic must come from font-style specifically, nothing else.
    const html = docExport([p('Flush left, plain text', 'c1'), p('1.1.11')].join(''));
    const { body } = convertDocHtml(html, 'T', new Map());

    assert.doesNotMatch(body, /class="italic"/);
});

// --- footnotes -----------------------------------------------------------

function footnoteFixture({ withOrphan = false } = {}) {
    return docExport(
        [
            '<p class="c5"><span>a troglodyte world</span>' +
                '<a href="#ftnt1" id="ftnt_ref1"><span>[1]</span></a><span>:</span></p>',
            withOrphan
                ? '<p class="c5"><span>orphaned</span><a href="#ftnt9" id="ftnt_ref9"><span>[9]</span></a></p>'
                : '',
            p('1.1.11'),
            '<div><hr></div>',
            '<div id="ftnt1"><p><a href="#ftnt_ref1" id="ftnt1"><span>[1]</span></a>' +
                '<span> </span><a href="https://en.wikipedia.org/wiki/Paul_Fussell">Fussell, Paul.</a>' +
                '<span> </span><span class="c3">The Great War and Modern Memory</span><span>. 1977.</span></p></div>',
        ].join('')
    );
}

test('a footnote reference becomes a numbered superscript, from the href alone', () => {
    const html = footnoteFixture();
    const { body } = convertDocHtml(html, 'T', new Map());

    assert.match(body, /a troglodyte world<sup class="footnote-number">1<\/sup>:/);
    // The visible "[1]" Docs put in the link text must not leak through.
    assert.doesNotMatch(body, /\[1\]/);
});

test('the footnote body renders as a styled paragraph, links and italics intact', () => {
    const html = footnoteFixture();
    const { footnotesHtml } = convertDocHtml(html, 'T', new Map());

    assert.equal(
        footnotesHtml,
        '<p class="footnote"><sup class="footnote-number">1</sup> ' +
            '<a href="https://en.wikipedia.org/wiki/Paul_Fussell">Fussell, Paul.</a> ' +
            '<span class="italic">The Great War and Modern Memory</span>. 1977.</p>'
    );
});

test('the self-referencing "[1]" backlink is stripped, not duplicated', () => {
    const html = footnoteFixture();
    const { footnotesHtml } = convertDocHtml(html, 'T', new Map());

    assert.equal(footnotesHtml.match(/\[1\]/g), null);
});

test('the footnote body is not also rendered as a line of the poem', () => {
    const html = footnoteFixture();
    const { body } = convertDocHtml(html, 'T', new Map());

    assert.doesNotMatch(body, /Fussell/);
});

test('a poem with no footnotes produces an empty footnotesHtml', () => {
    const html = docExport([p('Nothing special here'), p('1.1.11')].join(''));
    const { footnotesHtml } = convertDocHtml(html, 'T', new Map());

    assert.equal(footnotesHtml, '');
});

test('footnotes are ordered numerically, not by first appearance', () => {
    const html = docExport(
        [
            '<p class="c5"><span>b</span><a href="#ftnt2" id="ftnt_ref2"><span>[2]</span></a></p>',
            '<p class="c5"><span>a</span><a href="#ftnt1" id="ftnt_ref1"><span>[1]</span></a></p>',
            p('1.1.11'),
            '<div id="ftnt2"><p><a href="#ftnt_ref2" id="ftnt2"><span>[2]</span></a><span> second</span></p></div>',
            '<div id="ftnt1"><p><a href="#ftnt_ref1" id="ftnt1"><span>[1]</span></a><span> first</span></p></div>',
        ].join('')
    );
    const { footnotesHtml } = convertDocHtml(html, 'T', new Map());
    const order = [...footnotesHtml.matchAll(/footnote-number">(\d)</g)].map((m) => m[1]);

    assert.deepEqual(order, ['1', '2']);
});

test('a reference with no matching footnote body is reported, not silently dropped', () => {
    const html = footnoteFixture({ withOrphan: true });
    const { orphanFootnoteRefs } = convertDocHtml(html, 'T', new Map());

    assert.deepEqual(orphanFootnoteRefs, ['9']);
});

test('a reference with a matching body is not reported as an orphan', () => {
    const html = footnoteFixture();
    const { orphanFootnoteRefs } = convertDocHtml(html, 'T', new Map());

    assert.deepEqual(orphanFootnoteRefs, []);
});

// --- date-shape validation ---------------------------------------------

test('n.n.nn and nn.nn.nn are recognized as dates', () => {
    for (const d of ['6.20.4', '12.31.19', '4.27.9', '6.20.04']) {
        const html = docExport([p('A line'), p(d)].join(''));
        const { date } = convertDocHtml(html, 'T', new Map());
        assert.equal(date, d, `expected "${d}" to be read as a date`);
    }
});

test('"Circa YYYY" is recognized as a date, case-insensitively', () => {
    for (const d of ['Circa 2003', 'circa 2010', 'CIRCA 1998']) {
        const html = docExport([p('A line'), p(d)].join(''));
        const { date } = convertDocHtml(html, 'T', new Map());
        assert.equal(date, d);
    }
});

test('"Circa" dates that name something other than a year are still dates', () => {
    // Three published poems date themselves "Circa College", "Circa
    // Before Time" and "Circa an Alternate Reality". Requiring a year
    // after "Circa" left all three undated, with the date stranded as a
    // last line of verse instead of the red date under the poem.
    for (const d of ['Circa College', 'Circa Before Time', 'Circa an Alternate Reality']) {
        const html = docExport([p('A line'), p(d)].join(''));
        const { body, date } = convertDocHtml(html, 'T', new Map());

        assert.equal(date, d, `expected "${d}" to be read as a date`);
        assert.doesNotMatch(body, new RegExp(d));
    }
});

test('an ordinary last line is not turned into a date by mentioning a year', () => {
    // The "Circa ..." shape is open-ended, so the guard that keeps it
    // from eating verse is that the line has to START with Circa.
    for (const line of ['and gas-lit automaticrazy.', 'somewhere around 1977, maybe']) {
        const html = docExport([p('First line'), p(line)].join(''));
        const { body, date } = convertDocHtml(html, 'T', new Map());

        assert.equal(date, '', `expected "${line}" to stay verse`);
        assert.ok(
            body.endsWith(`<span class="line-number">2</span> ${line}`),
            `expected "${line}" to remain the last line of the body`
        );
    }
});

test('a poem with no date-shaped last line has an empty date, and keeps the line', () => {
    // The bug: the last line was always treated as the date, so a
    // dateless poem lost its actual final line of verse.
    const html = docExport([p('First line'), p('from half-sleep to waking-dream')].join(''));
    const { body, date } = convertDocHtml(html, 'T', new Map());

    assert.equal(date, '');
    assert.match(body, /<span class="line-number">2<\/span> from half-sleep to waking-dream$/);
});

test('a date-shaped line is still removed from the body and not double-counted', () => {
    const html = docExport([p('First line'), p('Second line'), p('12.31.19')].join(''));
    const { body, date } = convertDocHtml(html, 'T', new Map());

    assert.equal(date, '12.31.19');
    assert.doesNotMatch(body, /12\.31\.19/);
    assert.match(body, /<span class="line-number">2<\/span> Second line$/);
});

// --- multi-paragraph footnote bodies -------------------------------------

// The shape Drive actually exports: the footnote's id sits on the
// backlink <a> inside the first <p>, and a line break the poet typed in
// the footnote becomes a SECOND <p> beside it, carrying no id at all.
function splitFootnoteFixture() {
    return docExport(
        [
            '<p class="c5"><span>a troglodyte world</span>' +
                '<a href="#ftnt1" id="ftnt_ref1"><span>[1]</span></a><span>:</span></p>',
            p('11.26.10'),
            '<div>' +
                '<p class="c5"><a href="#ftnt_ref1" id="ftnt1"><span>[1]</span></a>' +
                '<span> Fussell, Paul. </span><span class="c3">The Great War and Modern Memory</span>' +
                '<span>. Oxford University Press, 1977.</span></p>' +
                '<p class="c5"><span>"The idea of the trenches has been assimilated" (36).</span></p>' +
                '</div>',
            '<div>' +
                '<p class="c5"><a href="#ftnt_ref2" id="ftnt2"><span>[2]</span></a>' +
                '<span> Sledge, E. B. Presidio Press, 2010.</span></p>' +
                '</div>',
        ].join('')
    );
}

test('a footnote broken across paragraphs keeps the passage quoted under the citation', () => {
    // The bug: only the paragraph holding the backlink was read, so
    // every citation was published truncated at its first line break -
    // "Fussell, Paul. ... 1977." with the quotation simply gone.
    const { footnotesHtml } = convertDocHtml(splitFootnoteFixture(), 'T', new Map());

    assert.match(footnotesHtml, /1977\. "The idea of the trenches has been assimilated" \(36\)\./);
});

test('a footnote stops at the next footnote, and does not swallow it', () => {
    const { footnotesHtml } = convertDocHtml(splitFootnoteFixture(), 'T', new Map());
    const [first, second] = footnotesHtml.split('\n');

    assert.doesNotMatch(first, /Sledge/);
    assert.match(second, /<sup class="footnote-number">2<\/sup> Sledge, E\. B\./);
});

test('the continuation paragraph is not also rendered as a line of the poem', () => {
    const { body } = convertDocHtml(splitFootnoteFixture(), 'T', new Map());

    assert.doesNotMatch(body, /The idea of the trenches/);
    assert.doesNotMatch(body, /Fussell/);
});

test('footnote bodies living directly in the body are still kept out of the poem', () => {
    // Same split-paragraph shape, but with no wrapping <div> - here the
    // continuation paragraph IS a sibling of the poem's own lines.
    const html = docExport(
        [
            '<p class="c5"><span>a world</span>' +
                '<a href="#ftnt1" id="ftnt_ref1"><span>[1]</span></a></p>',
            p('11.26.10'),
            '<p class="c5"><a href="#ftnt_ref1" id="ftnt1"><span>[1]</span></a><span> Fussell, Paul.</span></p>',
            '<p class="c5"><span>"Quoted passage" (36).</span></p>',
        ].join('')
    );
    const { body, footnotesHtml, date } = convertDocHtml(html, 'T', new Map());

    assert.match(footnotesHtml, /Fussell, Paul\. "Quoted passage" \(36\)\./);
    assert.doesNotMatch(body, /Quoted passage/);
    assert.equal(date, '11.26.10');
});

// --- italics, in every shape an export might use -------------------------

// Which of these Drive actually emits is not something this repo can
// verify (a test run has no credentials), and guessing wrong is what
// left the whole site without italics - so all of them are supported,
// and each one is pinned here.
const ITALIC_SHAPES = {
    'a class rule': ['<span class="c3">troglodyte world</span>', ''],
    'an inline style attribute': ['<span style="font-style:italic">troglodyte world</span>', ''],
    'an <i> tag': ['<i>troglodyte world</i>', ''],
    'an <em> tag': ['<em>troglodyte world</em>', ''],
    'a grouped selector': ['<span class="c7">troglodyte world</span>', '.c7,.c8{font-style:italic}'],
    'a second <style> block': [
        '<span class="c42">troglodyte world</span>',
        '</style><style type="text/css">.c42{font-style:italic}',
    ],
};

for (const [shape, [markup, extraCss]] of Object.entries(ITALIC_SHAPES)) {
    test(`italics survive when the export expresses them as ${shape}`, () => {
        const html = docExport(
            `<p class="c5"><span>a </span>${markup}<span>:</span></p>` + p('1.1.11'),
            extraCss
        );
        const { body } = convertDocHtml(html, 'T', new Map());

        assert.match(body, /a <span class="italic">troglodyte world<\/span>:/);
    });
}

test('a paragraph styled italic inline is italic, and still picks up its indent', () => {
    const html = docExport(
        '<p style="margin-left:36pt;font-style:italic"><span>Mud knee deep,</span></p>' + p('1.1.11')
    );
    const { body } = convertDocHtml(html, 'T', new Map());

    assert.match(
        body,
        /<span class="indent"><span class="italic">Mud knee deep,<\/span><\/span>/
    );
});

test('italic inside italic opens one span, not two nested ones', () => {
    const html = docExport(
        '<p class="c9"><span class="c3">Mud knee deep,</span></p>' + p('1.1.11')
    );
    const { body } = convertDocHtml(html, 'T', new Map());

    assert.equal((body.match(/<span class="italic">/g) || []).length, 1);
});

// --- superscripts typed by hand ------------------------------------------

test('a superscript number becomes the same marker a real footnote gets', () => {
    // Not every footnote in these Docs is a native Docs footnote; some
    // are a digit the poet typed and formatted as superscript.
    const html = docExport(
        '<p class="c5"><span>a troglodyte world</span>' +
            '<span style="vertical-align:super">1</span><span>:</span></p>' + p('1.1.11')
    );
    const { body } = convertDocHtml(html, 'T', new Map());

    assert.match(body, /a troglodyte world<sup class="footnote-number">1<\/sup>:/);
});

test('a superscript that is not a number stays an ordinary superscript', () => {
    const html = docExport(
        '<p class="c5"><span>Nov 1</span><span style="vertical-align:super">st</span>' +
            '<span>, cold.</span></p>' + p('1.1.11')
    );
    const { body } = convertDocHtml(html, 'T', new Map());

    assert.match(body, /Nov 1<sup>st<\/sup>, cold\./);
    assert.doesNotMatch(body, /footnote-number/);
});

test('a native footnote reference is not double-wrapped by an enclosing <sup>', () => {
    const html = docExport(
        '<p class="c5"><span>world</span><sup><a href="#ftnt1" id="ftnt_ref1">[1]</a></sup></p>' +
            p('1.1.11') +
            '<div id="ftnt1"><p><a href="#ftnt_ref1" id="ftnt1"><span>[1]</span></a><span> Fussell.</span></p></div>'
    );
    const { body } = convertDocHtml(html, 'T', new Map());

    assert.match(body, /world<sup class="footnote-number">1<\/sup>/);
    assert.doesNotMatch(body, /<sup><sup/);
});

// --- the whole pipeline, through the real template ----------------------

test('footnotes reach the actual published page, not just the converter output', async () => {
    const template = await readFile(TEMPLATE_PATH, 'utf8');
    const html = footnoteFixture();
    const { body, date, footnotesHtml } = convertDocHtml(html, 'T', new Map());

    const page = renderPage(template, { title: 'T', body, date, footnotesHtml });

    assert.equal(page.match(/\{\{[A-Z]+\}\}/g), null, 'no placeholder left unfilled');
    assert.match(page, /<p class="footnote"><sup class="footnote-number">1<\/sup>/);
});

test('an empty {{FOOTNOTES}} substitution leaves exactly one blank line, not a stack of them', async () => {
    // A blank line here is fine - body no longer preserves whitespace as
    // significant (see css.test.mjs), so it renders as nothing. What
    // would still be a real bug is the substitution leaving more than
    // one, which no fix in this PR is meant to introduce.
    const template = await readFile(TEMPLATE_PATH, 'utf8');
    const html = docExport([p('A line'), p('1.1.11')].join(''));
    const { body, date, footnotesHtml } = convertDocHtml(html, 'T', new Map());

    const page = renderPage(template, { title: 'T', body, date, footnotesHtml });

    assert.match(page, /<\/pre>\n\n<\/div>/);
});

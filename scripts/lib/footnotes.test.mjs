// Tests for footnotes, block-level italics, and date-shape validation.
//
// All three came from the same source: the first real SNAFU sync. Its
// indented stanza is entirely italic (Google Docs put font-style on the
// paragraph itself, not an inner span), it has two footnote citations,
// and comparing against the hand-made page showed both silently
// disappearing. Date validation is a related fix in the same area: it
// stops a poem with no date-shaped last line from having that line
// swallowed into <em> as though it were one.

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

    assert.match(page, /<\/pre>\n\n<\/body>/);
});

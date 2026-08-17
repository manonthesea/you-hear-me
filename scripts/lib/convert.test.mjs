// Tests for the Google Doc -> poem page conversion.
//
// Run with `npm test`. These exercise convert.mjs against fixtures shaped
// like Drive's text/html export (class-based styles in a <style> block,
// Google redirect-wrapped links), plus the template substitution in
// render.mjs.
//
// What these do NOT cover: whether real Docs exports match these
// fixtures. Still eyeball a poem's first sync.

import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { convertDocHtml } from './convert.mjs';
import { renderPage } from './render.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, '..', '..', 'templates', 'poem-template.html');

// Builds a fixture shaped like a Drive text/html export.
function docExport(bodyHtml, extraCss = '') {
    return `<html><head><style type="text/css">
.c1{margin-left:36pt}
.c2{margin-left:72pt}
.c3{font-style:italic}
.c5{padding-top:0pt;padding-bottom:0pt}
.c9{margin-left:216pt}
${extraCss}
</style></head><body class="doc-content">${bodyHtml}</body></html>`;
}

const p = (inner, cls = 'c5') => `<p class="${cls}"><span>${inner}</span></p>`;
const blank = '<p class="c5"><span></span></p>';

test('numbers lines and treats the last line as the date', () => {
    const html = docExport([p('First line'), p('Second line'), blank, p('6.20.4')].join(''));
    const { body, date } = convertDocHtml(html, 'Some Poem', new Map());

    assert.equal(date, '6.20.4');
    assert.match(body, /<span class="line-number">1<\/span> First line/);
    assert.match(body, /<span class="line-number">2<\/span> Second line/);
    assert.doesNotMatch(body, /6\.20\.4/, 'date should not also appear in the body');
});

test('skips a first line that repeats the title, case-insensitively', () => {
    const html = docExport([p('marsh VOICES'), p('Chit chat.'), p('6.20.4')].join(''));
    const { body } = convertDocHtml(html, 'Marsh Voices', new Map());

    assert.doesNotMatch(body, /marsh VOICES/);
    assert.match(body, /<span class="line-number">1<\/span> Chit chat\./);
});

test('keeps a first line that merely resembles the title', () => {
    const html = docExport([p('Marsh Voices carry far'), p('6.20.4')].join(''));
    const { body } = convertDocHtml(html, 'Marsh Voices', new Map());

    assert.match(body, /<span class="line-number">1<\/span> Marsh Voices carry far/);
});

test('blank paragraphs become stanza breaks without consuming a line number', () => {
    const html = docExport([p('One'), blank, p('Two'), p('1.1.11')].join(''));
    const { body } = convertDocHtml(html, 'T', new Map());

    assert.match(body, /line-number">1<\/span> One\n\n<span class="line-number">2<\/span> Two/);
});

test('Heading 2 becomes a stanza heading and does not take a line number', () => {
    const html = docExport(
        [p('Before'), '<h2 class="c5"><span>1.</span></h2>', p('After'), p('1.1.11')].join('')
    );
    const { body } = convertDocHtml(html, 'T', new Map());

    assert.match(body, /<h2>1\.<\/h2>/);
    assert.match(body, /line-number">2<\/span> After/, 'heading must not increment numbering');
});

test('maps indent levels onto the site indent classes', () => {
    const html = docExport(
        [p('Flush', 'c5'), p('One in', 'c1'), p('Two in', 'c2'), p('Way in', 'c9'), p('1.1.11')].join('')
    );
    const { body } = convertDocHtml(html, 'T', new Map());

    assert.match(body, /<span class="indent">One in<\/span>/);
    assert.match(body, /<span class="double-indent">Two in<\/span>/);
    assert.match(body, /<span class="fifth-indent">Way in<\/span>/);
    assert.doesNotMatch(body, /<span class="[a-z-]*indent">Flush/);
});

test('wraps italics and ellipses in their styled spans', () => {
    const html = docExport(
        [
            '<p class="c5"><span>plain </span><span class="c3">italic</span><span> tail . . . end</span></p>',
            p('1.1.11'),
        ].join('')
    );
    const { body } = convertDocHtml(html, 'T', new Map());

    assert.match(body, /<span class="italic">italic<\/span>/);
    assert.match(body, /<span class="green-ellipsis">\. \. \.<\/span>/);
});

test('rewrites links to sibling poem Docs as local filenames', () => {
    const href =
        'https://www.google.com/url?q=https://docs.google.com/document/d/DOC123/edit&amp;sa=D';
    const html = docExport(
        [
            `<p class="c5"><span>see </span><a href="${href}"><span>the marsh</span></a></p>`,
            p('1.1.11'),
        ].join('')
    );
    const { body } = convertDocHtml(
        html,
        'T',
        new Map([['DOC123', 'Marsh Voices.html']])
    );

    assert.match(body, /<a href="Marsh Voices\.html">the marsh<\/a>/);
});

test('unwraps Google redirects but leaves genuinely external links external', () => {
    const href =
        'https://www.google.com/url?q=https://www.poetryfoundation.org/poems/47311&amp;sa=D';
    const html = docExport(
        [`<p class="c5"><a href="${href}"><span>waste land</span></a></p>`, p('1.1.11')].join('')
    );
    const { body } = convertDocHtml(html, 'T', new Map());

    assert.match(body, /<a href="https:\/\/www\.poetryfoundation\.org\/poems\/47311">/);
});

test('leaves an unknown Doc link alone rather than inventing a filename', () => {
    const href = 'https://docs.google.com/document/d/UNKNOWN/edit';
    const html = docExport(
        [`<p class="c5"><a href="${href}"><span>elsewhere</span></a></p>`, p('1.1.11')].join('')
    );
    const { body } = convertDocHtml(html, 'T', new Map([['DOC123', 'Other.html']]));

    assert.match(body, /href="https:\/\/docs\.google\.com\/document\/d\/UNKNOWN\/edit"/);
});

test('escapes HTML-significant characters in the poem text', () => {
    const html = docExport([p('a &lt; b &amp; c'), p('1.1.11')].join(''));
    const { body } = convertDocHtml(html, 'T', new Map());

    assert.match(body, /a &lt; b &amp; c/);
    assert.doesNotMatch(body, /a < b/);
});

test('renders a complete page with no placeholders left behind', async () => {
    const template = await readFile(TEMPLATE_PATH, 'utf8');
    const html = docExport([p('A line'), p('8.17.26')].join(''));
    const { body, date } = convertDocHtml(html, 'x.x.test', new Map());

    const page = renderPage(template, { title: 'x.x.test', body, date });

    assert.equal(
        page.match(/\{\{[A-Z]+\}\}/g),
        null,
        'template placeholders must all be substituted'
    );
    assert.match(page, /<title>x\.x\.test<\/title>/);
    assert.match(page, /<h1>x\.x\.test<\/h1>/);
    assert.match(page, /<em>8\.17\.26<\/em>/);
    assert.match(page, /<link rel="stylesheet" href="assets\/poem\.css">/);
});

test('the template contains each placeholder exactly once', async () => {
    const template = await readFile(TEMPLATE_PATH, 'utf8');

    // Regression guard: a stray {{BODY}} in a comment used to swallow the
    // poem, leaving a literal "{{BODY}}" on the published page.
    assert.equal(template.match(/\{\{BODY\}\}/g).length, 1);
    assert.equal(template.match(/\{\{DATE\}\}/g).length, 1);
    assert.equal(template.match(/\{\{TITLE\}\}/g).length, 2, 'once in <title>, once in <h1>');
});

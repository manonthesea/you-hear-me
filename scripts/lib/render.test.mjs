// Tests for filling the poem template.
//
// The column count gets the most attention here because it is the kind
// of number that fails quietly: a poem sized from a wrong count still
// renders, still reads, and is simply the wrong size - on a phone, which
// is where nobody is looking when they change a stylesheet.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { columnsFor, cssPathFor, escapeHtml, renderPage } from './render.mjs';

const TEMPLATE = `<html><head><link rel="stylesheet" href="{{CSS_PATH}}"><title>{{TITLE}}</title></head>
<body><div class="poem" style="--cols: {{COLS}}"><h1>{{TITLE}}</h1><pre>
{{BODY}}

<em>{{DATE}}</em>
</pre>{{FOOTNOTES}}</div></body></html>`;

const numbered = (...lines) =>
    lines.map((l, i) => `<span class="line-number">${i + 1}</span> ${l}`).join('\n');

// --- how wide is the poem ------------------------------------------------

test('the widest line decides, not the first or the last', () => {
    const cols = columnsFor(numbered('short', 'a good deal longer than the others', 'mid'));

    assert.equal(cols, 'a good deal longer than the others'.length);
});

test('the line number does not count toward the width', () => {
    // It sits in a fixed 30px box shifted into the gutter, outside the
    // text flow, so a poem does not get wider on reaching line 100.
    const one = columnsFor('<span class="line-number">1</span> twelve chars');
    const huge = columnsFor('<span class="line-number">100</span> twelve chars');

    assert.equal(one, huge);
    assert.equal(one, 'twelve chars'.length);
});

test('markup does not count - only what a reader sees', () => {
    const plain = columnsFor(numbered('one two three'));
    const linked = columnsFor(numbered('one <a href="../a/very/long/path.html">two</a> three'));
    const italic = columnsFor(numbered('one <span class="italic">two</span> three'));

    assert.equal(linked, plain, 'an href is not visible width');
    assert.equal(italic, plain);
});

test('an entity counts as the single character it renders as', () => {
    // "&amp;" is five characters of source and one of ink. Counting the
    // source would size the poem for a line nobody can see.
    assert.equal(columnsFor(numbered('a &amp; b')), 'a & b'.length);
    assert.equal(columnsFor(numbered('&lt;&gt;&quot;&#39;')), 4);
});

test('trailing whitespace does not widen a line', () => {
    // The Docs export leaves it on most lines; it prints as nothing.
    assert.equal(columnsFor(numbered('four   ')), 4);
});

test('an indent counts as the width it actually occupies', () => {
    // The indents are px, so they do not shrink when the type does -
    // a line pushed 80px right needs that space whatever the font size.
    const flat = columnsFor(numbered('word'));
    const once = columnsFor(numbered('<span class="indent">word</span>'));
    const twice = columnsFor(numbered('<span class="double-indent">word</span>'));

    assert.equal(flat, 4);
    assert.equal(once, Math.ceil(4 + 40 / 9.6));
    assert.equal(twice, Math.ceil(4 + 80 / 9.6));
});

test('an empty poem still reports a usable width', () => {
    // Dividing by this in a stylesheet, zero would be an infinite size.
    for (const body of ['', '\n\n\n', undefined]) {
        assert.ok(columnsFor(body) >= 1, JSON.stringify(body));
    }
});

// --- the page ------------------------------------------------------------

test('the column count reaches the page', () => {
    const page = renderPage(TEMPLATE, {
        title: 'T',
        body: numbered('a line of exactly forty-two characters!!'),
        date: '1.1.20',
    });

    assert.match(page, /style="--cols: 40"/);
});

test('the count is derived from the body, not asked of the caller', () => {
    // Nothing passes it in, so nothing can forget to.
    const wide = renderPage(TEMPLATE, { title: 'T', body: numbered('x'.repeat(90)), date: 'd' });
    const narrow = renderPage(TEMPLATE, { title: 'T', body: numbered('x'.repeat(10)), date: 'd' });

    assert.match(wide, /--cols: 90"/);
    assert.match(narrow, /--cols: 10"/);
});

test('a $ in the poem survives substitution', () => {
    // "$&" and "$1" are replacement patterns to String.replaceAll. A poem
    // containing one would otherwise have it silently rewritten into a
    // copy of the placeholder it replaced.
    const page = renderPage(TEMPLATE, {
        title: 'Cost of $5 & $&',
        body: numbered('he paid $& and $1 for it'),
        date: '$`',
        footnotesHtml: '<div>$$</div>',
    });

    assert.match(page, /he paid \$& and \$1 for it/);
    assert.match(page, /Cost of \$5 &amp; \$&/);
    assert.match(page, /<em>\$`<\/em>/);
    assert.match(page, /<div>\$\$<\/div>/);
});

test('every placeholder is filled', () => {
    const page = renderPage(TEMPLATE, {
        title: 'T', body: numbered('x'), date: 'd', footnotesHtml: '<p>f</p>',
    });

    assert.doesNotMatch(page, /\{\{[A-Z_]+\}\}/, 'a placeholder survived into the page');
});

// --- unchanged behaviour --------------------------------------------------

test('the stylesheet path still climbs out of nested folders', () => {
    assert.equal(cssPathFor(''), 'assets/poem.css');
    assert.equal(cssPathFor('2020-2021/1. Winter'), '../../assets/poem.css');
});

test('escapeHtml still escapes the three that matter', () => {
    assert.equal(escapeHtml('a & b < c > d'), 'a &amp; b &lt; c &gt; d');
});

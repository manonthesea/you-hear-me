// Tests for finding an anchor phrase in a line of poem and linking it.
//
// Every rule here exists because of a real mistake made against this
// collection, not a hypothetical one. The fixtures are lines from the
// poems as the converter actually renders them.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { findPhrase, linkPhrase, linkPhraseAcross, linkPhraseInBody } from './anchor.mjs';

const HREF = 'Target.html';
const link = (html, phrase) => linkPhrase(html, phrase, HREF);

// --- whole words ---------------------------------------------------------

test('a phrase does not match inside a longer word', () => {
    // The bug: "her" matched inside "whether", reporting an ambiguity
    // that did not exist and sending us looking for a second occurrence
    // the poem never had.
    const line = "Then it's him and her up the stairs";
    const other = 'and knows not whether it day or night';

    assert.equal(findPhrase(line, 'her').length, 1);
    assert.equal(findPhrase(other, 'her').length, 0);
});

test('a phrase ending at a word edge still matches', () => {
    assert.equal(findPhrase('Green frog falls into black.', 'black').length, 1);
});

test('punctuation is not a word character, so it does not block a match', () => {
    assert.equal(findPhrase('Sitting upon the hill of Butte Chaumont,', 'Butte Chaumont').length, 1);
});

// --- exact case ----------------------------------------------------------

test('matching is case-sensitive', () => {
    // "Rains too long in coming" begins the line; the ledger entry that
    // said "rains" was simply wrong, and had to fail rather than match.
    const line = 'Rains too long in coming';

    assert.equal(findPhrase(line, 'Rains too long in coming').length, 1);
    assert.equal(findPhrase(line, 'rains too long in coming').length, 0);
});

// --- quote folding -------------------------------------------------------

test("a straight apostrophe in the ledger finds a curly one in the poem", () => {
    // Docs exports curly quotes; nobody types those into a config file.
    const line = 'over lying men’s heads:';

    assert.equal(findPhrase(line, "men's heads").length, 1);
});

test('a curly apostrophe in the ledger also finds a straight one', () => {
    assert.equal(findPhrase("over lying men's heads:", 'men’s heads').length, 1);
});

// --- literal, never a pattern -------------------------------------------

test('regex metacharacters are matched literally', () => {
    // Real anchors include "March 25th, 1945" and ". . ." - a matcher
    // that compiled these as patterns would match wildly or throw.
    for (const [line, phrase] of [
        ['History is still made on March 25th, 1945.', 'March 25th, 1945'],
        ['earthly reality . . . existing', '. . .'],
        ['a (parenthetical) aside', '(parenthetical)'],
        ['costs $5 or more', '$5'],
    ]) {
        assert.equal(findPhrase(line, phrase).length, 1, `failed on "${phrase}"`);
    }
});

test('a phrase absent from the line matches nothing', () => {
    assert.equal(findPhrase('Green frog falls into black.', 'blackness').length, 0);
});

// --- wrapping ------------------------------------------------------------

test('a phrase inside one text run is wrapped in place', () => {
    const result = link('and repetitive repetition', 'repetitive repetition');

    assert.equal(result.ok, true);
    assert.equal(result.html, 'and <a href="Target.html">repetitive repetition</a>');
});

test('the line around the anchor is left exactly as it was', () => {
    const line = '<span class="line-number">5</span> and repetitive repetition';
    const result = link(line, 'repetitive repetition');

    assert.match(result.html, /^<span class="line-number">5<\/span> and <a /);
});

test('a phrase spanning two elements opens an anchor in each, never a split tag', () => {
    // A quoted stanza is one italic run per line, and a single line is
    // often several spans, so an anchor routinely crosses a boundary.
    // Wrapping once across it would put "<a>" inside one element and
    // "</a>" inside another.
    const line = '<span class="italic">was to look upward </span><span class="italic">away the earthly</span>';
    const result = link(line, 'look upward away the');

    assert.equal(result.ok, true);
    assert.equal((result.html.match(/<a href/g) || []).length, 2);
    assert.equal((result.html.match(/<\/a>/g) || []).length, 2);
    // Tags still balance, and no anchor straddles a span boundary.
    assert.doesNotMatch(result.html, /<a[^>]*>[^<]*<span/);
    assert.equal(
        result.html,
        '<span class="italic">was to <a href="Target.html">look upward </a></span>' +
            '<span class="italic"><a href="Target.html">away the</a> earthly</span>'
    );
});

test('the visible text is unchanged by linking', () => {
    const line = '<span class="italic">was to look upward </span><span class="italic">away the earthly</span>';
    const strip = (h) => h.replace(/<[^>]*>/g, '');

    assert.equal(strip(link(line, 'look upward away the').html), strip(line));
});

test('an anchor that ends exactly at a tag boundary closes once', () => {
    const line = '<span class="italic">Mud knee deep</span> in some places';
    const result = link(line, 'Mud knee deep');

    assert.equal(result.html, '<span class="italic"><a href="Target.html">Mud knee deep</a></span> in some places');
});

// --- entities ------------------------------------------------------------

test('a phrase matches text that the converter escaped', () => {
    // The poem's "&" is "&amp;" in the markup: one character of text,
    // five of markup. Splitting on raw offsets would cut it in half.
    const line = 'salt &amp; pepper on the sill';
    const result = link(line, 'salt & pepper');

    assert.equal(findPhrase(line, 'salt & pepper').length, 1);
    assert.equal(result.html, '<a href="Target.html">salt &amp; pepper</a> on the sill');
});

// --- refusing, loudly ----------------------------------------------------

test('a phrase that is gone from the poem is reported, not guessed at', () => {
    const result = link('Green frog falls into black.', 'blackness');

    assert.equal(result.ok, false);
    assert.equal(result.count, 0);
    assert.equal(result.reason, 'not found');
    assert.equal(result.html, 'Green frog falls into black.', 'the line must be left alone');
});

test('an ambiguous phrase is refused, never silently first-match', () => {
    // "purchased meaning" really does appear twice in People in the
    // Street. Linking the first would have been wrong: the original
    // linked the second.
    const line = 'stripped of purchased meaning and later purchased meaning again';
    const result = link(line, 'purchased meaning');

    assert.equal(result.ok, false);
    assert.equal(result.count, 2);
    assert.match(result.reason, /lengthen the phrase/);
});

test('lengthening the phrase resolves an ambiguity', () => {
    const line = 'stripped of purchased meaning and constructs of purchased meaning';

    assert.equal(link(line, 'purchased meaning').ok, false);
    assert.equal(link(line, 'constructs of purchased meaning').ok, true);
});

test('an anchor inside an existing link is refused', () => {
    // Nested anchors are invalid; the browser unnests them and the inner
    // link just disappears.
    const line = 'see <a href="Other.html">the marsh reeds</a> at dusk';
    const result = link(line, 'marsh reeds');

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'already inside a link');
});

test('an anchor after an existing link is fine', () => {
    const line = 'see <a href="Other.html">the marsh</a> at dusk';
    const result = link(line, 'at dusk');

    assert.equal(result.ok, true);
    assert.equal((result.html.match(/<a href/g) || []).length, 2);
});

// --- across a whole poem -------------------------------------------------

const BODY = [
    '<span class="line-number">1</span> The signal is digging in,',
    '<span class="line-number">2</span> digging trenches until disjunction inherits',
    '<span class="line-number">3</span> a <span class="italic">troglodyte world</span>:',
    '<span class="line-number">4</span> and repetitive repetition',
].join('\n');

test('an anchor is applied to the one line that carries it', () => {
    const result = linkPhraseInBody(BODY, 'repetitive repetition', HREF);

    assert.equal(result.ok, true);
    const lines = result.body.split('\n');
    assert.match(lines[3], /and <a href="Target\.html">repetitive repetition<\/a>$/);
    assert.equal(lines.slice(0, 3).join('\n'), BODY.split('\n').slice(0, 3).join('\n'));
});

test('a phrase on two different lines is ambiguous, not first-wins', () => {
    const body = ['<span class="line-number">1</span> the marsh', '<span class="line-number">2</span> the marsh'].join('\n');
    const result = linkPhraseInBody(body, 'the marsh', HREF);

    assert.equal(result.ok, false);
    assert.equal(result.count, 2);
    assert.equal(result.body, body);
});

test('an anchor cannot run across a line break into the next line number', () => {
    // "in, digging" spans the newline in the visible text. Matching per
    // line keeps it from ever being found there.
    assert.equal(linkPhraseInBody(BODY, 'digging in, digging', HREF).ok, false);
});

test('a line number cannot be mistaken for verse', () => {
    const result = linkPhraseInBody(BODY, 'signal', HREF);

    assert.equal(result.ok, true);
    assert.match(result.body, /<span class="line-number">1<\/span> The <a href="Target\.html">signal<\/a>/);
});

// --- verse and footnotes together ---------------------------------------

test('an anchor in a footnote is linked, not just one in the verse', () => {
    // The hand-made SNAFU linked Fussell's name inside its citation.
    const regions = {
        body: '<span class="line-number">1</span> a troglodyte world',
        footnotes: '<p class="footnote"><sup class="footnote-number">1</sup> Fussel, Paul. 1977.</p>',
    };
    const result = linkPhraseAcross(regions, 'Fussel, Paul.', HREF);

    assert.equal(result.ok, true);
    assert.match(result.regions.footnotes, /<a href="Target\.html">Fussel, Paul\.<\/a>/);
    assert.equal(result.regions.body, regions.body, 'the verse is untouched');
});

test('a phrase in both verse and footnote is ambiguous across the whole page', () => {
    const regions = { body: 'the marsh reeds', footnotes: '<p class="footnote">the marsh reeds</p>' };
    const result = linkPhraseAcross(regions, 'marsh reeds', HREF);

    assert.equal(result.ok, false);
    assert.equal(result.count, 2);
    assert.deepEqual(result.regions, regions);
});

test('an empty footnote region is harmless', () => {
    const result = linkPhraseAcross({ body: 'and repetitive repetition', footnotes: '' }, 'repetitive repetition', HREF);

    assert.equal(result.ok, true);
    assert.match(result.regions.body, /<a href="Target\.html">/);
});

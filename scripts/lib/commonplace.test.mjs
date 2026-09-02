// Tests for the Commonplace Book's data.
//
// The page is a map, and the failure mode of a map is not that it
// breaks - it is that it stays plausible while being wrong. So these
// test the things that would go quietly wrong: a poem dropped because
// it has no ledger entry, a plate counted as a poem, an ordering that
// puts a 2021 poem before a 2009 one, a description whose numbers no
// longer match the map underneath it.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildDataset, dateKey, describe, eraLabel, erasIn, renderCommonplace } from './commonplace.mjs';

const ledger = {
    poems: new Map([
        ['snafu', { doc: 'doc-snafu', title: 'SNAFU' }],
        ['march', { doc: 'doc-march', title: 'March' }],
    ]),
    embeds: new Map(),
};

const entries = [
    { id: 'doc-snafu', path: '$Pre-2010/11.26.10.html' },
    { id: 'doc-march', path: '2020-2021/1. Winter/2.4.21.html' },
    // Published, but nobody has given it a ledger entry yet.
    { id: 'doc-orphan', path: '2024-2025=/4. Fall/10.10.25.html' },
    // Not a poem.
    { id: 'plate:patton.jpg', path: 'plates/patton/index.html' },
];

const titles = new Map([
    ['$Pre-2010/11.26.10.html', 'SNAFU'],
    ['2020-2021/1. Winter/2.4.21.html', 'March'],
    ['2024-2025=/4. Fall/10.10.25.html', 'An Orphan'],
]);

const bySource = new Map([
    [
        '$Pre-2010/11.26.10.html',
        [
            { phrase: 'repetitive repetition', target: { kind: 'poem', path: '2020-2021/1. Winter/2.4.21.html' } },
            { phrase: 'Fussell, Paul.', target: { kind: 'external', url: 'https://e.org' } },
            { phrase: 'pee', target: { kind: 'plate', path: 'plates/patton/index.html' } },
        ],
    ],
]);

const dataset = () => buildDataset({ ledger, entries, bySource, titles });

// --- what belongs on the map ---------------------------------------------

test('every published poem appears, ledger entry or not', () => {
    // The unwoven ones are the whole reason to look at the map.
    const { poems } = dataset();

    assert.equal(poems.length, 3);
    assert.deepEqual(poems.map((p) => p.title).sort(), ['An Orphan', 'March', 'SNAFU']);
});

test('a plate is not a poem', () => {
    const { poems } = dataset();

    assert.ok(!poems.some((p) => p.path.startsWith('plates/')));
});

test('a poem with no ledger entry still gets a stable key', () => {
    // Keyed by slug where there is one, by path where there is not -
    // otherwise every unwoven poem would collide on the same empty key.
    const { poems } = dataset();
    const orphan = poems.find((p) => p.title === 'An Orphan');

    assert.equal(orphan.slug, null);
    assert.equal(orphan.key, '_2024-2025=/4. Fall/10.10.25.html');
});

// --- what counts as a thread ---------------------------------------------

test('only poem-to-poem links become edges', () => {
    const { edges } = dataset();

    assert.equal(edges.length, 1);
    assert.deepEqual(edges[0], { from: 'snafu', to: 'march', phrase: 'repetitive repetition' });
});

test('pictures and outbound links stay on the card, out of the graph', () => {
    // Counting these as citations is exactly how the old link map came
    // to claim three times as many poems as the collection has.
    const { poems } = dataset();
    const snafu = poems.find((p) => p.key === 'snafu');

    assert.deepEqual(snafu.extras, [
        { kind: 'external', phrase: 'Fussell, Paul.' },
        { kind: 'image', phrase: 'pee' },
    ]);
});

// --- ordering -------------------------------------------------------------

test('a dated filename sorts by its date, not its digits', () => {
    // "11.26.10" is November 2010 and "2.4.21" is February 2021; sorted
    // as text the first would win.
    assert.equal(dateKey('11.26.10').sortKey, '2010-11-26');
    assert.equal(dateKey('2.4.21').sortKey, '2021-02-04');
    assert.ok(dateKey('11.26.10').sortKey < dateKey('2.4.21').sortKey);
});

test('three poems sharing a date keep their given order', () => {
    const [a, b, c] = ['1.27.21a', '1.27.21b', '1.27.21c'].map((s) => dateKey(s).sortKey);

    assert.ok(a < b && b < c, `${a} ${b} ${c}`);
});

test('a "Circa" year places the poem in that year, loosely', () => {
    const circa = dateKey('Circa 2009');

    assert.equal(circa.sortKey.slice(0, 4), '2009');
    assert.equal(circa.dated, false, 'not a real date, and should not be shown as one');
});

test('an undateable name sorts last rather than guessing', () => {
    // "Circa Before Time" and "Circa College" have no year to find.
    for (const base of ['Circa Before Time', 'Circa College']) {
        const { sortKey, dated } = dateKey(base);
        assert.ok(sortKey.startsWith('9999-'), base);
        assert.equal(dated, false);
    }
});

// --- the page itself ------------------------------------------------------

test('the description is generated, so its numbers cannot drift', () => {
    const text = describe(dataset());

    assert.match(text, /3 poems/);
    assert.match(text, /2010–2025/);
});

test('the data is embedded as parseable JSON', () => {
    const page = renderCommonplace(
        '<script id="dataset" type="application/json">{{DATA}}</script>{{SITE_ROOT}}{{DESCRIPTION}}',
        dataset()
    );
    const json = page.slice(page.indexOf('>') + 1, page.indexOf('</script>'));

    assert.equal(JSON.parse(json).poems.length, 3);
});

test('a closing script tag inside the data cannot end the block early', () => {
    // No poem is titled this. The page should not depend on that.
    const hostile = {
        poems: [{ key: 'x', slug: 'x', title: '</script><b>oops', era: '$Pre-2010', path: 'x.html', base: 'x', sortKey: '2010-01-01', dated: true, extras: [] }],
        edges: [],
    };
    const page = renderCommonplace('<script>{{DATA}}</script>{{SITE_ROOT}}{{DESCRIPTION}}', hostile);

    assert.ok(!page.includes('</script><b>oops'), 'the tag escaped into the markup');
    assert.match(page, /<\\\/script>/);
});

test('the site root is empty for the copy that lives beside the poems', () => {
    // In the repo the page sits at the root, so a poem path is already
    // the right href; a prefix would break every link on the map.
    const page = renderCommonplace('[{{SITE_ROOT}}]{{DATA}}{{DESCRIPTION}}', dataset());

    assert.match(page, /\[\]/);
});

test('a site root is used verbatim when one is given', () => {
    const page = renderCommonplace('[{{SITE_ROOT}}]{{DATA}}{{DESCRIPTION}}', {
        ...dataset(),
        siteRoot: 'https://example.org/poems/',
    });

    assert.match(page, /\[https:\/\/example\.org\/poems\/\]/);
});

test('a "$" in a poem path survives into the page', () => {
    // "$Pre-2010" is a real folder, and "$&" and friends are replacement
    // patterns in String.replace - a naive substitution mangles them.
    const page = renderCommonplace('{{DATA}}{{SITE_ROOT}}{{DESCRIPTION}}', dataset());

    assert.ok(page.includes('$Pre-2010/11.26.10.html'), 'the path was rewritten');
});

// --- eras -----------------------------------------------------------------

test('the sorting mark on a folder is not shown to the reader', () => {
    // The folders carry a punctuation mark so they sort in order on
    // disk; it is bookkeeping, not a name.
    assert.equal(eraLabel('2016-2017!'), '2016\u20132017');
    assert.equal(eraLabel('2018-2019&'), '2018\u20132019');
    assert.equal(eraLabel('2022-2023+'), '2022\u20132023');
    assert.equal(eraLabel('2024-2025='), '2024\u20132025');
    assert.equal(eraLabel('2010-2011^'), '2010\u20132011');
    assert.equal(eraLabel('2020-2021'), '2020\u20132021', 'a folder with no mark is left alone');
    assert.equal(eraLabel('$Pre-2010'), 'Before 2010');
});

test('the eras are read from the poems, not from a list written by hand', () => {
    // This is the bug that prompted all of it: a seventh folder arrived
    // from Drive, the written-out list still named six, and the poem in
    // it was in the data with no shelf to stand on.
    const poems = [
        { era: '2020-2021' },
        { era: '2010-2011^' },
        { era: '$Pre-2010' },
        { era: '2020-2021' },
    ];

    assert.deepEqual(erasIn(poems), [
        { key: '$Pre-2010', label: 'Before 2010' },
        { key: '2010-2011^', label: '2010\u20132011' },
        { key: '2020-2021', label: '2020\u20132021' },
    ]);
});

test('an era nobody anticipated sorts last rather than vanishing', () => {
    // Being unrecognised is not a reason to go missing from the map.
    const eras = erasIn([{ era: 'Notebooks' }, { era: '2020-2021' }, { era: '$Pre-2010' }]);

    assert.deepEqual(eras.map((e) => e.key), ['$Pre-2010', '2020-2021', 'Notebooks']);
});

test('every poem on the map belongs to an era the map draws', () => {
    // The page renders era by era, so a poem whose era is not listed is
    // silently left off - along with every thread that touched it.
    const data = dataset();
    const listed = new Set(data.eras.map((e) => e.key));

    for (const poem of data.poems) {
        assert.ok(listed.has(poem.era), `${poem.title} is in "${poem.era}", which no shelf covers`);
    }
});

test('every thread joins two poems that are actually drawn', () => {
    // An edge whose endpoint has no card is skipped without a word, so
    // the header can claim more threads than the map shows.
    const data = dataset();
    const drawn = new Set(data.poems.map((p) => p.key));

    for (const edge of data.edges) {
        assert.ok(drawn.has(edge.from) && drawn.has(edge.to), `${edge.from} -> ${edge.to}`);
    }
});

test('the eras reach the page with the data', () => {
    const page = renderCommonplace('{{DATA}}{{SITE_ROOT}}{{DESCRIPTION}}', dataset());
    const parsed = JSON.parse(page.slice(0, page.lastIndexOf('}') + 1));

    assert.ok(parsed.eras.length > 0);
    assert.deepEqual(parsed.eras[0], { key: '$Pre-2010', label: 'Before 2010' });
});

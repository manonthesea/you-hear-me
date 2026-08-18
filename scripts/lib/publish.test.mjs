// Tests for the publish gate and the Drive-tree -> repo-path mapping.
//
// The publish gate gets the most attention here on purpose. The repo is
// public and its history is permanent, so a false positive doesn't just
// render a page wrong — it discloses a poem the author meant to keep
// back, and a later commit can't undo that. The tests below lean toward
// proving things are NOT published.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { convertDocHtml } from './convert.mjs';
import {
    findCollisions,
    outputPathFor,
    parseDocName,
    sanitizeSegment,
    selectOrphans,
} from './paths.mjs';

function docExport(bodyHtml) {
    return `<html><head><style type="text/css">
.c5{padding-top:0pt;padding-bottom:0pt}
</style></head><body class="doc-content">${bodyHtml}</body></html>`;
}

const p = (inner) => `<p class="c5"><span>${inner}</span></p>`;

// --- the publish gate -----------------------------------------------

test('a Doc with no annotation is not published', () => {
    assert.deepEqual(parseDocName('Marsh Voices'), {
        title: 'Marsh Voices',
        published: false,
    });
});

test('a "(Publish)" annotation publishes and is stripped from the title', () => {
    assert.deepEqual(parseDocName('Marsh Voices (Publish)'), {
        title: 'Marsh Voices',
        published: true,
    });
});

test('annotation matching accepts the documented variants', () => {
    for (const name of [
        'Marsh Voices (Publish)',
        'Marsh Voices (publish)',
        'Marsh Voices (PUBLISH)',
        'Marsh Voices (Published)',
        'Marsh Voices ( Publish )',
        'Marsh Voices(Publish)',
    ]) {
        const { title, published } = parseDocName(name);
        assert.equal(published, true, `expected "${name}" to publish`);
        assert.equal(title, 'Marsh Voices', `expected clean title from "${name}"`);
    }
});

test('names merely mentioning publishing do not publish the Doc', () => {
    // The gate must be a deliberate annotation, never something a title
    // could say in passing.
    for (const name of [
        'Publishing House',
        'Unpublished',
        'Notes on Publishing',
        'Publish',
        'To Publish Someday',
        'Marsh Voices [Publish]',
    ]) {
        assert.equal(
            parseDocName(name).published,
            false,
            `expected "${name}" NOT to publish`
        );
    }
});

test('the annotation is stripped from the output path too', () => {
    const { title } = parseDocName('Marsh Voices (Publish)');
    assert.deepEqual(outputPathFor(['Early Work'], title), {
        dir: 'Early Work',
        filePath: 'Early Work/Marsh Voices.html',
    });
});

test('a mid-name annotation does not leave doubled spaces in the title', () => {
    assert.equal(parseDocName('Marsh (Publish) Voices').title, 'Marsh Voices');
});

test('the clean title is what the Doc\'s repeated first line is matched against', () => {
    // The Doc is named "Marsh Voices (Publish)" but its first line
    // repeats only "Marsh Voices" — that line must still be skipped.
    const html = docExport([p('Marsh Voices'), p('Chit chat.'), p('6.20.4')].join(''));
    const { title } = parseDocName('Marsh Voices (Publish)');
    const { body, date } = convertDocHtml(html, title, new Map());

    assert.equal(date, '6.20.4');
    assert.match(body, /^<span class="line-number">1<\/span> Chit chat\.$/);
});

// --- Drive tree -> repo paths ---------------------------------------

test('folder structure is mirrored into the output path', () => {
    assert.deepEqual(outputPathFor([], 'Marsh Voices'), {
        dir: '',
        filePath: 'Marsh Voices.html',
    });
    assert.deepEqual(outputPathFor(['Early Work'], 'Marsh Voices'), {
        dir: 'Early Work',
        filePath: 'Early Work/Marsh Voices.html',
    });
    assert.deepEqual(outputPathFor(['A', 'B'], 'C'), {
        dir: 'A/B',
        filePath: 'A/B/C.html',
    });
});

test('path-breaking characters are stripped from names', () => {
    assert.equal(sanitizeSegment('Le Maison du René Magritte'), 'Le Maison du René Magritte');
    assert.equal(sanitizeSegment('A/B'), 'AB');
    assert.equal(sanitizeSegment('  padded  '), 'padded');
    assert.equal(sanitizeSegment('what?'), 'what');
    // '#' would truncate the URL at a fragment.
    assert.equal(sanitizeSegment('No #1'), 'No 1');
});

test('same name in different folders is not a collision', () => {
    const entries = [
        { id: '1', name: 'Winter', ...outputPathFor(['Early'], 'Winter') },
        { id: '2', name: 'Winter', ...outputPathFor(['Late'], 'Winter') },
    ];
    assert.deepEqual(findCollisions(entries), []);
});

test('two Docs landing on one path are reported as a collision', () => {
    const entries = [
        { id: '1', name: 'Winter', ...outputPathFor(['Early'], 'Winter') },
        { id: '2', name: 'Winter?', ...outputPathFor(['Early'], 'Winter?') },
    ];
    const collisions = findCollisions(entries);

    assert.equal(collisions.length, 1);
    assert.equal(collisions[0].filePath, 'Early/Winter.html');
    assert.deepEqual(collisions[0].names.sort(), ['Winter', 'Winter?']);
});

// --- deletion --------------------------------------------------------

test('orphans are pages that dropped out of the manifest', () => {
    const orphans = selectOrphans(
        ['A.html', 'Early/B.html', 'C.html'],
        ['A.html', 'Early/B.html']
    );
    assert.deepEqual(orphans, ['C.html']);
});

test('a page that moved folders orphans its old path', () => {
    const orphans = selectOrphans(['Early/B.html'], ['Late/B.html']);
    assert.deepEqual(orphans, ['Early/B.html']);
});

test('nothing outside the previous manifest can ever be deleted', () => {
    // The hand-made pages predate the sync and are not in any manifest;
    // no combination of inputs may select them.
    const handMade = ['Marsh Voices.html', 'SNAFU.html', 'index.html'];
    const orphans = selectOrphans([], handMade);

    assert.deepEqual(orphans, []);
});

test('an empty run orphans everything the manifest listed', () => {
    // Every Doc unpublished at once is a legitimate (if drastic) state.
    const orphans = selectOrphans(['A.html', 'B.html'], []);
    assert.deepEqual(orphans, ['A.html', 'B.html']);
});

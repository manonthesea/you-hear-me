// Fills the canonical poem template (templates/poem-template.html) with a
// converted poem's title, body, and date.
//
// Kept separate from sync-poems.mjs so it can be exercised without
// touching the network: the template substitution is exactly where a
// regression silently produces a page full of literal "{{BODY}}".

import path from 'node:path';

export function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Poems mirror their Drive folders, so a page can sit any number of
// directories deep. The stylesheet lives at the repo root either way.
export function cssPathFor(dir) {
    return path.posix.join(path.posix.relative(dir || '.', '.') || '.', 'assets/poem.css');
}

// The indents are set in px, so they do not shrink when the type does.
// Folding them in at the base size keeps the count honest about how wide
// a line actually is, rather than how many letters it happens to contain.
const INDENT_PX = { indent: 40, 'double-indent': 80, 'fifth-indent': 200 };
// Courier New advances exactly 0.6em, which is 9.6px at the 16px base.
const CHAR_PX = 9.6;

/**
 * How wide the poem is, in characters.
 *
 * <pre> does not wrap, so a poem's longest line is what decides whether
 * it fits a screen - and the poems vary enormously: the median is around
 * 56 characters and the widest is 118. One font size cannot serve both,
 * which is why this is measured per poem rather than guessed at once in
 * the stylesheet.
 *
 * Measured on the text a reader actually sees: tags do not count, an
 * entity counts as the one character it renders as, and the line number
 * does not count at all because it sits in its own fixed box in the
 * gutter, outside the text flow.
 *
 * Nothing reads this yet. It is published so that a later stylesheet can
 * size each poem to fit without the generator having to change again.
 *
 * @param {string} body - the verse, as rendered into {{BODY}}.
 * @returns {number} characters in the widest line, at least 1.
 */
export function columnsFor(body) {
    let widest = 0;
    for (const raw of String(body).split('\n')) {
        const line = raw.replace(/<span class="line-number">[^<]*<\/span>\s?/, '');
        const indent = line.match(/class="((?:double-|fifth-)?indent)"/);
        const pad = indent ? (INDENT_PX[indent[1]] ?? 0) / CHAR_PX : 0;
        const text = decodeEntities(line.replace(/<[^>]*>/g, '')).replace(/\s+$/, '');
        widest = Math.max(widest, text.length + pad);
    }
    return Math.max(1, Math.ceil(widest));
}

// Only the entities this pipeline emits. A full decoder would be a
// liability here: anything it got wrong would silently mis-size a poem.
function decodeEntities(text) {
    return text
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&');
}

/**
 * @param {string} template - contents of templates/poem-template.html
 * @param {{ title: string, body: string, date: string, dir?: string, footnotesHtml?: string }} poem
 * @returns {string} the finished page
 */
export function renderPage(template, { title, body, date, dir = '', footnotesHtml = '' }) {
    return template
        .replaceAll('{{TITLE}}', () => escapeHtml(title))
        .replaceAll('{{CSS_PATH}}', cssPathFor(dir))
        // Derived here rather than passed in, so a caller cannot forget it.
        .replaceAll('{{COLS}}', String(columnsFor(body)))
        .replaceAll('{{BODY}}', () => body)
        .replaceAll('{{DATE}}', () => escapeHtml(date))
        .replaceAll('{{FOOTNOTES}}', () => footnotesHtml);
}

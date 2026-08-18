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

/**
 * @param {string} template - contents of templates/poem-template.html
 * @param {{ title: string, body: string, date: string, dir?: string }} poem
 * @returns {string} the finished page
 */
export function renderPage(template, { title, body, date, dir = '' }) {
    return template
        .replaceAll('{{TITLE}}', escapeHtml(title))
        .replaceAll('{{CSS_PATH}}', cssPathFor(dir))
        .replaceAll('{{BODY}}', body)
        .replaceAll('{{DATE}}', escapeHtml(date));
}

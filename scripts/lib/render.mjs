// Fills the canonical poem template (templates/poem-template.html) with a
// converted poem's title, body, and date.
//
// Kept separate from sync-poems.mjs so it can be exercised without
// touching the network: the template substitution is exactly where a
// regression silently produces a page full of literal "{{BODY}}".

export function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * @param {string} template - contents of templates/poem-template.html
 * @param {{ title: string, body: string, date: string }} poem
 * @returns {string} the finished page
 */
export function renderPage(template, { title, body, date }) {
    return template
        .replaceAll('{{TITLE}}', escapeHtml(title))
        .replaceAll('{{BODY}}', body)
        .replaceAll('{{DATE}}', escapeHtml(date));
}

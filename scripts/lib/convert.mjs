// Converts a Google Doc's exported HTML (Drive files.export, mimeType
// text/html) into the site's canonical poem markup (see
// templates/poem-template.html).
//
// Authoring conventions this relies on, in the source Google Doc:
//   - The Doc's file name is the poem title. An optional first line that
//     repeats the title is detected and skipped.
//   - The LAST non-blank paragraph is the date line (e.g. "6.20.4",
//     "Circa 2010").
//   - "Heading 2" paragraphs become stanza headings.
//   - Indent level is read from the paragraph's left margin/padding and
//     bucketed into the site's existing .indent / .double-indent /
//     .fifth-indent levels. This is a best-effort heuristic — spot-check
//     indentation after the first sync of a poem.
//   - Cross-poem links: paste a link to the target Doc directly in
//     Google Docs. If the linked Doc is in the same synced folder, the
//     link is rewritten to the local "<Title>.html" filename; otherwise
//     it's left as an external link.
//   - Native Google Docs footnotes are not converted yet — poems using
//     footnotes stay hand-maintained until that's added.

import * as cheerio from 'cheerio';

const ELLIPSIS_RE = /(\.\s?\.\s?\.|…)/g;

function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function parseStyleMap(html) {
    const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
    const map = new Map();
    if (!styleMatch) return map;
    const ruleRe = /\.(c\d+)\s*\{([^}]*)\}/g;
    let m;
    while ((m = ruleRe.exec(styleMatch[1])) !== null) {
        const [, className, body] = m;
        const props = {};
        for (const decl of body.split(';')) {
            const [k, v] = decl.split(':');
            if (k && v) props[k.trim().toLowerCase()] = v.trim().toLowerCase();
        }
        map.set(className, props);
    }
    return map;
}

function mergedProps(styleMap, classAttr) {
    const props = {};
    for (const cls of (classAttr || '').split(/\s+/).filter(Boolean)) {
        Object.assign(props, styleMap.get(cls));
    }
    return props;
}

function isItalicProps(props) {
    return props['font-style'] === 'italic';
}

function toPx(value) {
    if (!value) return 0;
    const m = value.match(/([\d.]+)(pt|px)/);
    if (!m) return 0;
    const num = parseFloat(m[1]);
    return m[2] === 'pt' ? num * (4 / 3) : num;
}

function indentClassFor(props) {
    const px = Math.max(toPx(props['margin-left']), toPx(props['padding-left']));
    if (px >= 240) return 'fifth-indent';
    if (px >= 96) return 'double-indent';
    if (px >= 30) return 'indent';
    return null;
}

function unwrapGoogleRedirect(href) {
    try {
        const u = new URL(href);
        if (u.hostname === 'www.google.com' && u.pathname === '/url') {
            const q = u.searchParams.get('q');
            if (q) return q;
        }
    } catch {
        // not a URL we can parse, fall through
    }
    return href;
}

function resolveHref(href, docIdToFilename) {
    const real = unwrapGoogleRedirect(href);
    const docMatch = real.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/);
    if (docMatch) {
        const filename = docIdToFilename.get(docMatch[1]);
        if (filename) return filename;
    }
    return real;
}

function wrapEllipses(text) {
    const parts = text.split(ELLIPSIS_RE);
    return parts
        .map((part, i) =>
            i % 2 === 1
                ? `<span class="green-ellipsis">${escapeHtml(part)}</span>`
                : escapeHtml(part)
        )
        .join('');
}

// Renders the inline contents of a paragraph (text, italics, links) to HTML.
function renderInline($, node, styleMap, docIdToFilename) {
    let out = '';
    for (const child of $(node).contents().toArray()) {
        if (child.type === 'text') {
            out += wrapEllipses(child.data);
        } else if (child.type === 'tag' && child.tagName === 'a') {
            const href = resolveHref($(child).attr('href') || '', docIdToFilename);
            out += `<a href="${escapeHtml(href)}">${renderInline($, child, styleMap, docIdToFilename)}</a>`;
        } else if (child.type === 'tag' && child.tagName === 'span') {
            const props = mergedProps(styleMap, $(child).attr('class'));
            const inner = renderInline($, child, styleMap, docIdToFilename);
            out += isItalicProps(props) ? `<span class="italic">${inner}</span>` : inner;
        } else if (child.type === 'tag') {
            out += renderInline($, child, styleMap, docIdToFilename);
        }
    }
    return out;
}

/**
 * @param {string} html - Drive files.export text/html content for the Doc.
 * @param {string} title - poem title (from the Drive file name).
 * @param {Map<string,string>} docIdToFilename - other poem Doc IDs -> local filename, for cross-poem links.
 * @returns {{ body: string, date: string }}
 */
export function convertDocHtml(html, title, docIdToFilename) {
    const $ = cheerio.load(html);
    const styleMap = parseStyleMap(html);
    const blocks = $('body').children().toArray();

    const lines = []; // { type: 'stanza', text } | { type: 'line', html } | { type: 'blank' }
    let sawFirstContent = false;

    for (const el of blocks) {
        const $el = $(el);
        const tag = el.tagName?.toLowerCase();

        if (tag === 'h2' || tag === 'h3') {
            const text = $el.text().trim();
            if (text) lines.push({ type: 'stanza', text });
            continue;
        }

        if (tag !== 'p' && tag !== 'h1') continue;

        const plainText = $el.text().trim();

        if (!sawFirstContent) {
            if (!plainText) continue; // skip leading blank paragraphs
            sawFirstContent = true;
            if (tag === 'h1' || plainText.toLowerCase() === title.trim().toLowerCase()) {
                continue; // redundant title line
            }
        }

        if (!plainText) {
            lines.push({ type: 'blank' });
            continue;
        }

        const props = mergedProps(styleMap, $el.attr('class'));
        const indentClass = indentClassFor(props);
        let inner = renderInline($, el, styleMap, docIdToFilename);
        if (indentClass) inner = `<span class="${indentClass}">${inner}</span>`;

        lines.push({ type: 'line', html: inner });
    }

    // Drop leading blanks: a Doc that repeats its title on the first line
    // usually follows it with an empty paragraph, which would otherwise
    // open the poem with a stray blank line under the title.
    while (lines.length && lines[0].type === 'blank') lines.shift();

    // Trim trailing blank lines, then the last "line" is the date.
    while (lines.length && lines[lines.length - 1].type === 'blank') lines.pop();
    const dateEntry = [...lines].reverse().find((l) => l.type === 'line');
    const date = dateEntry ? $('<div>').html(dateEntry.html).text() : '';
    if (dateEntry) lines.splice(lines.lastIndexOf(dateEntry), 1);
    while (lines.length && lines[lines.length - 1].type === 'blank') lines.pop();

    let lineNumber = 0;
    const rendered = lines.map((l) => {
        if (l.type === 'blank') return '';
        if (l.type === 'stanza') return `\n<h2>${escapeHtml(l.text)}</h2>\n`;
        lineNumber += 1;
        const spaced = l.html.startsWith('<span class="indent')
            ? l.html
            : ` ${l.html}`;
        return `<span class="line-number">${lineNumber}</span>${spaced}`;
    });

    return { body: rendered.join('\n'), date };
}

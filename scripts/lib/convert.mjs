// Converts a Google Doc's exported HTML (Drive files.export, mimeType
// text/html) into the site's canonical poem markup (see
// templates/poem-template.html).
//
// Authoring conventions this relies on, in the source Google Doc:
//   - The poem's title is the Doc's FIRST LINE, not its file name (the
//     Docs are named by date). The title line is stripped from the body.
//   - The LAST non-blank paragraph is the date line (e.g. "6.20.4",
//     "Circa 2010").
//   - "Heading 2" paragraphs are stanza markers, as is any line that is
//     only a number and a period ("1.", "2."). They render as numbered
//     lines styled green, not as headings.
//   - Every line is numbered, blank lines and stanza markers included;
//     runs of blank lines collapse to one.
//   - Indent level is read from the paragraph's left margin/padding and
//     bucketed into the site's existing .indent / .double-indent /
//     .fifth-indent levels. This is a best-effort heuristic — spot-check
//     indentation after the first sync of a poem.
//   - Cross-poem links: paste a link to the target Doc directly in
//     Google Docs. If the linked Doc is in the same synced folder, the
//     link is rewritten to a relative path to that poem; otherwise
//     it's left as an external link.
//   - Native Google Docs footnotes are not converted yet — poems using
//     footnotes stay hand-maintained until that's added.

import path from 'node:path';
import * as cheerio from 'cheerio';

const ELLIPSIS_RE = /(\.\s?\.\s?\.|…)/g;

// A line that is nothing but a number and a period ("1.", "2.") is a
// section marker. It is still a line of the poem — numbered like any
// other — and only the green .stanza styling sets it apart.
const STANZA_MARKER_RE = /^\d+\.$/;

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

// Turns a link to a sibling poem's Doc into a relative path from the
// page currently being written. With poems mirrored into folders, a link
// from "Early Work/A.html" to "Late Work/B.html" has to become
// "../Late Work/B.html", not a bare filename.
export function relativeLink(fromDir, toPath) {
    const rel = path.posix.relative(fromDir || '.', toPath);
    return rel || toPath;
}

// Returns the href to emit, or null when the link points at a Doc that
// is not published. Emitting the docs.google.com URL in that case would
// put a private Doc's address on a public page and hand readers a link
// that only opens a permission wall.
function resolveHref(href, docIdToPath, currentDir) {
    const real = unwrapGoogleRedirect(href);
    const docMatch = real.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/);
    if (docMatch) {
        const target = docIdToPath.get(docMatch[1]);
        return target ? relativeLink(currentDir, target) : null;
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
function renderInline($, node, styleMap, docIdToPath, currentDir, unresolved) {
    let out = '';
    for (const child of $(node).contents().toArray()) {
        if (child.type === 'text') {
            out += wrapEllipses(child.data);
        } else if (child.type === 'tag' && child.tagName === 'a') {
            const href = resolveHref($(child).attr('href') || '', docIdToPath, currentDir);
            const inner = renderInline($, child, styleMap, docIdToPath, currentDir, unresolved);
            if (href === null) {
                // Keep the words, drop the link.
                unresolved.push($(child).text().trim());
                out += inner;
            } else {
                out += `<a href="${escapeHtml(href)}">${inner}</a>`;
            }
        } else if (child.type === 'tag' && child.tagName === 'span') {
            const props = mergedProps(styleMap, $(child).attr('class'));
            const inner = renderInline($, child, styleMap, docIdToPath, currentDir, unresolved);
            out += isItalicProps(props) ? `<span class="italic">${inner}</span>` : inner;
        } else if (child.type === 'tag') {
            out += renderInline($, child, styleMap, docIdToPath, currentDir, unresolved);
        }
    }
    return out;
}

/**
 * The poem's title is the Doc's first line of real text — Docs here are
 * named by date, so the name is not the title. Section markers and blank
 * paragraphs are skipped so a poem opening with "1." still finds it.
 *
 * @param {string} html - Drive files.export text/html content for the Doc.
 * @returns {string} the first line's text, or '' if the Doc has none.
 */
export function extractTitle(html) {
    const $ = cheerio.load(html);
    for (const el of $('body').children().toArray()) {
        const tag = el.tagName?.toLowerCase();
        if (tag !== 'p' && tag !== 'h1') continue;
        const text = $(el).text().trim();
        if (!text || STANZA_MARKER_RE.test(text)) continue;
        return text;
    }
    return '';
}

/**
 * @param {string} html - Drive files.export text/html content for the Doc.
 * @param {string} title - poem title (from the Drive file name).
 * @param {Map<string,string>} docIdToPath - other poem Doc IDs -> repo-relative output path, for cross-poem links.
 * @param {string} currentDir - repo-relative directory this page is written to, so links can be made relative to it.
 * @returns {{ body: string, date: string, unresolved: string[] }}
 */
export function convertDocHtml(html, title, docIdToPath, currentDir = '') {
    const $ = cheerio.load(html);
    const styleMap = parseStyleMap(html);
    const blocks = $('body').children().toArray();

    const lines = []; // { type: 'stanza', text } | { type: 'line', html } | { type: 'blank' }
    const unresolved = []; // link texts pointing at unpublished poems
    let sawFirstContent = false;

    for (const el of blocks) {
        const $el = $(el);
        const tag = el.tagName?.toLowerCase();

        if (tag === 'h2' || tag === 'h3') {
            const text = $el.text().trim();
            if (text) {
                lines.push({ type: 'stanza', text });
                sawFirstContent = true;
            }
            continue;
        }

        if (tag !== 'p' && tag !== 'h1') continue;

        const plainText = $el.text().trim();

        if (STANZA_MARKER_RE.test(plainText)) {
            lines.push({ type: 'stanza', text: plainText });
            // A marker is content: without this, a blank line right after
            // a poem-opening marker is mistaken for a leading blank and
            // trimmed away.
            sawFirstContent = true;
            continue;
        }

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
        let inner = renderInline($, el, styleMap, docIdToPath, currentDir, unresolved);
        if (indentClass) inner = `<span class="${indentClass}">${inner}</span>`;

        lines.push({ type: 'line', html: inner });
    }

    // Collapse runs of blank paragraphs to a single blank line. A page
    // break or a spacer gap in a Doc can produce dozens of empty
    // paragraphs in the export; reproduced literally they tear the poem
    // apart on the page. One blank line is the stanza break the hand-made
    // pages use.
    for (let i = lines.length - 1; i > 0; i--) {
        if (lines[i].type === 'blank' && lines[i - 1].type === 'blank') {
            lines.splice(i, 1);
        }
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

    // Every line of the poem is numbered — blank lines and stanza markers
    // included. The page is meant to read like a poem open in a code
    // editor, where every line has a number.
    let lineNumber = 0;
    const rendered = lines.map((l) => {
        lineNumber += 1;
        const number = `<span class="line-number">${lineNumber}</span>`;
        if (l.type === 'blank') return number;
        if (l.type === 'stanza') {
            return `${number} <span class="stanza">${escapeHtml(l.text)}</span>`;
        }
        const spaced = l.html.startsWith('<span class="indent') ? l.html : ` ${l.html}`;
        return `${number}${spaced}`;
    });

    return { body: rendered.join('\n'), date, unresolved };
}

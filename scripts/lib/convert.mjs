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
//   - The LAST non-blank line is the date ONLY if it looks like one
//     (n.n.nn, nn.nn.nn, or "Circa YYYY"). Anything else is left as a
//     normal line, and the date is empty.
//   - Native Google Docs footnotes: a reference link to "#ftntN" becomes
//     a numbered superscript, and the matching "id=\"ftntN\"" footnote
//     body is rendered as a <p class="footnote"> after the poem. This is
//     a best-effort match to Google's export shape — verify a footnoted
//     poem's first sync.

import path from 'node:path';
import * as cheerio from 'cheerio';

const ELLIPSIS_RE = /(\.\s?\.\s?\.|…)/g;

// A line that is nothing but a number and a period ("1.", "2.") is a
// section marker. It is still a line of the poem — numbered like any
// other — and only the green .stanza styling sets it apart.
const STANZA_MARKER_RE = /^\d+\.$/;

// The standardized date shapes: n.n.nn / nn.nn.nn, or "Circa YYYY". A
// last line that doesn't match either is verse, not a date - without
// this, the last line of a dateless poem would be silently swallowed
// into <em> as if it were one.
const DATE_RE = /^(\d{1,2}\.\d{1,2}\.\d{1,4}|circa\s+\d{3,4})$/i;

// A footnote reference in Google Docs' export is a link to "#ftnt1"
// (not "#ftnt_ref1", which is the backlink the other direction). The
// number comes straight from the fragment, so it doesn't matter whether
// Docs wraps the visible "[1]" in a <sup>, brackets, or plain text.
const FOOTNOTE_REF_RE = /^#ftnt(\d+)$/i;
// A footnote's own id ("ftnt1") - the target of the reference above.
const FOOTNOTE_ID_RE = /^ftnt(\d+)$/i;

// Block elements that can hold a line of the poem. Headings are included
// because a Doc's title is commonly styled Heading 2 or 3.
const BLOCK_TAGS = ['p', 'h1', 'h2', 'h3'];

// Plain text of a rendered segment, for the blank / marker / title checks.
function plainText(segmentHtml) {
    return cheerio.load(`<div>${segmentHtml}</div>`)('div').text().trim();
}

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

// Renders a paragraph's inline contents into one or more lines.
//
// A soft line break in Google Docs (Shift+Enter) exports as <br> inside
// the paragraph, so one <p> can hold a whole stanza. Each <br> starts a
// new line. Wrapper elements are re-applied per segment, so a break
// inside an italic run or a link cannot split a tag across lines.
function renderSegments($, node, styleMap, docIdToPath, currentDir, unresolved, footnoteRefs) {
    const segments = [''];
    const append = (str) => {
        segments[segments.length - 1] += str;
    };
    const appendAll = (parts, wrap) => {
        parts.forEach((part, i) => {
            if (i > 0) segments.push('');
            append(wrap(part));
        });
    };

    for (const child of $(node).contents().toArray()) {
        if (child.type === 'text') {
            append(wrapEllipses(child.data));
            continue;
        }
        if (child.type !== 'tag') continue;

        const tag = child.tagName?.toLowerCase();
        if (tag === 'br') {
            segments.push('');
            continue;
        }

        if (tag === 'a') {
            const rawHref = $(child).attr('href') || '';
            const footnoteRef = rawHref.match(FOOTNOTE_REF_RE);
            if (footnoteRef) {
                // The visible marker (however Docs formatted it - "[1]",
                // a bracketless number, a <sup>) is discarded and
                // replaced with our own, so the styling is consistent
                // regardless of how the source happened to format it.
                footnoteRefs.push(footnoteRef[1]);
                append(`<sup class="footnote-number">${footnoteRef[1]}</sup>`);
                continue;
            }

            const inner = renderSegments($, child, styleMap, docIdToPath, currentDir, unresolved, footnoteRefs);
            const href = resolveHref(rawHref, docIdToPath, currentDir);
            if (href === null) {
                // Keep the words, drop the link.
                unresolved.push($(child).text().trim());
                appendAll(inner, (part) => part);
            } else {
                const safe = escapeHtml(href);
                appendAll(inner, (part) => (part ? `<a href="${safe}">${part}</a>` : part));
            }
            continue;
        }

        const inner = renderSegments($, child, styleMap, docIdToPath, currentDir, unresolved, footnoteRefs);

        if (tag === 'span' && isItalicProps(mergedProps(styleMap, $(child).attr('class')))) {
            appendAll(inner, (part) => (part ? `<span class="italic">${part}</span>` : part));
            continue;
        }

        appendAll(inner, (part) => part);
    }
    return segments;
}

// Finds footnote body definitions anywhere in the Doc (the id that a
// "#ftnt1" reference points at) and renders each one's content, minus
// the self-referencing "[1]" backlink Docs repeats at the start of it.
//
// Returns a Map<number-as-string, renderedHtml>, and the set of raw DOM
// nodes used as containers so the main loop can skip them - otherwise a
// footnote living in a top-level <p> would also be read as a poem line.
function extractFootnotes($, styleMap, docIdToPath, currentDir, unresolved) {
    const scratchRefs = [];
    const footnotes = new Map();
    const containerNodes = new Set();

    $('[id]').each((_, el) => {
        const id = $(el).attr('id') || '';
        const match = id.match(FOOTNOTE_ID_RE);
        if (!match) return;

        const tag = el.tagName?.toLowerCase();
        const $container = ['p', 'div'].includes(tag) ? $(el) : $(el).closest('p, div');
        if (!$container.length) return;

        containerNodes.add($container.get(0));

        const $clone = $container.clone();
        $clone.find(`[id="${id}"]`).remove();
        let text = renderSegments($, $clone.get(0), styleMap, docIdToPath, currentDir, unresolved, scratchRefs)
            .join(' ')
            .trim();
        // Some Docs versions leave the visible "[1]"/"1." marker as plain
        // text rather than inside the removable backlink; strip it too.
        text = text.replace(/^(\[\d+\]|\d+\.)\s*/, '');
        if (text) footnotes.set(match[1], text);
    });

    return { footnotes, containerNodes };
}

/**
 * The poem's title is the first line of real text in the Doc. Docs here
 * are named by date, so the name is not the title.
 *
 * Headings count: a title is often styled Heading 2 or 3 rather than
 * left as plain text, and skipping those promoted a line of verse to the
 * title instead. Section markers and blanks are skipped so a poem
 * opening with "1." still finds its title, and only the first segment of
 * a paragraph is considered, since a <br> means the rest is another line.
 *
 * @param {string} html - Drive files.export text/html content for the Doc.
 * @returns {string} the first line's text, or '' if the Doc has none.
 */
export function extractTitle(html) {
    const $ = cheerio.load(html);
    for (const el of $('body').children().toArray()) {
        const tag = el.tagName?.toLowerCase();
        if (!['p', 'h1', 'h2', 'h3'].includes(tag)) continue;
        const firstSegment = $(el).html()?.split(/<br\s*\/?>/i)[0] ?? '';
        const text = cheerio.load(`<div>${firstSegment}</div>`)('div').text().trim();
        if (!text || STANZA_MARKER_RE.test(text)) continue;
        return text;
    }
    return '';
}

/**
 * @param {string} html - Drive files.export text/html content for the Doc.
 * @param {string} title - the poem's title; the line matching it is dropped from the body.
 * @param {Map<string,string>} docIdToPath - other poem Doc IDs -> repo-relative output path, for cross-poem links.
 * @param {string} currentDir - repo-relative directory this page is written to, so links can be made relative to it.
 * @returns {{ body: string, date: string, unresolved: string[], footnotesHtml: string, orphanFootnoteRefs: string[] }}
 */
export function convertDocHtml(html, title, docIdToPath, currentDir = '') {
    const $ = cheerio.load(html);
    const styleMap = parseStyleMap(html);
    const blocks = $('body').children().toArray();

    const lines = []; // { type: 'stanza', text } | { type: 'line', html } | { type: 'blank' }
    const unresolved = []; // link texts pointing at unpublished poems
    const footnoteRefs = []; // footnote numbers actually referenced in the text
    let sawFirstContent = false;

    const { footnotes, containerNodes } = extractFootnotes(
        $,
        styleMap,
        docIdToPath,
        currentDir,
        unresolved
    );

    for (const el of blocks) {
        const $el = $(el);
        const tag = el.tagName?.toLowerCase();
        if (containerNodes.has(el)) continue; // a footnote body, not a poem line
        if (!BLOCK_TAGS.includes(tag)) continue;

        // A heading in a Doc is either the poem's title or a section
        // marker; which one depends only on whether it comes first.
        const isHeading = tag !== 'p';
        const props = mergedProps(styleMap, $el.attr('class'));
        const indentClass = indentClassFor(props);
        // When a whole line is italic, Google Docs commonly puts
        // font-style on the PARAGRAPH's own class rather than an inner
        // <span> - there is nothing left inside the paragraph for the
        // per-span italic check in renderSegments to ever see.
        const isBlockItalic = isItalicProps(props);
        const segments = renderSegments($, el, styleMap, docIdToPath, currentDir, unresolved, footnoteRefs);

        for (const segment of segments) {
            const text = plainText(segment);

            if (!sawFirstContent) {
                if (!text) continue; // leading blanks are not part of the poem
                sawFirstContent = true;
                if (text.toLowerCase() === title.trim().toLowerCase()) {
                    continue; // this is the title; it becomes the <h1>
                }
            }

            if (!text) {
                lines.push({ type: 'blank' });
                continue;
            }

            if (isHeading || STANZA_MARKER_RE.test(text)) {
                lines.push({ type: 'stanza', text });
                continue;
            }

            let inner = isBlockItalic ? `<span class="italic">${segment}</span>` : segment;
            if (indentClass) inner = `<span class="${indentClass}">${inner}</span>`;
            lines.push({ type: 'line', html: inner });
        }
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

    // Trim trailing blanks, then the last "line" is the date - but only
    // if it actually looks like one. A poem with no date convention line
    // would otherwise have its final line of real verse silently
    // swallowed into <em> as though it were a date.
    while (lines.length && lines[lines.length - 1].type === 'blank') lines.pop();
    const lastLineEntry = [...lines].reverse().find((l) => l.type === 'line');
    const lastLineText = lastLineEntry ? plainText(lastLineEntry.html) : '';
    const hasDate = Boolean(lastLineEntry) && DATE_RE.test(lastLineText);
    const date = hasDate ? lastLineText : '';
    if (hasDate) {
        lines.splice(lines.lastIndexOf(lastLineEntry), 1);
        while (lines.length && lines[lines.length - 1].type === 'blank') lines.pop();
    }

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

    const footnotesHtml = [...footnotes.entries()]
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([number, text]) => `<p class="footnote"><sup class="footnote-number">${number}</sup> ${text}</p>`)
        .join('\n');

    // A "#ftnt3" reference with no matching "id=\"ftnt3\"" body means a
    // footnote's citation text did not survive the export - worth
    // surfacing rather than silently publishing a numbered marker with
    // nothing at the bottom of the page for it to point at.
    const orphanFootnoteRefs = [...new Set(footnoteRefs)].filter((n) => !footnotes.has(n));

    return { body: rendered.join('\n'), date, unresolved, footnotesHtml, orphanFootnoteRefs };
}

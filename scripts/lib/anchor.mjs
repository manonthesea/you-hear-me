// Finding a phrase inside a rendered line of poem, and wrapping it in a
// link.
//
// This is the risky half of keeping links in a config file rather than
// in the Docs: the anchor is text, and the poem it points into is edited
// somewhere else. Five of the collection's links were already broken
// this way before any of this existed - "Marsh Voices" no longer
// contains "blackness". Nothing can prevent that. What this module can
// do is make it impossible to fail QUIETLY: a phrase either matches
// exactly once, or the caller is told precisely what went wrong.
//
// Three matching rules, each from a real mistake:
//
//   Whole words.  "her" must not match inside "whether". A substring
//                 matcher reported an ambiguity that did not exist.
//   Exact case.   "rains" must not match "Rains too long in coming" -
//                 the line begins with a capital, and an anchor that
//                 ignores case is an anchor that can drift.
//   Folded quotes. The Docs export curly quotes; a config file is typed
//                 with straight ones. "men's" has to find "men’s".
//
// Everything else is literal. No regex, no stemming, no fuzzy fallback -
// a near miss must fail and say so, never guess.

// Only substitutions that map one character to one character, so a
// position in the folded text is a position in the real text.
const FOLDED = new Map([
    ['‘', "'"],
    ['’', "'"],
    ['“', '"'],
    ['”', '"'],
    [' ', ' '],
]);

const ENTITIES = new Map([
    ['&amp;', '&'],
    ['&lt;', '<'],
    ['&gt;', '>'],
    ['&quot;', '"'],
    ['&apos;', "'"],
    ['&#39;', "'"],
    ['&nbsp;', ' '],
]);

const ENTITY_RE = /&(?:#\d+|#x[0-9a-f]+|[a-z]+);/gi;
const TAG_RE = /<[^>]*>/g;

function foldChar(ch) {
    return FOLDED.get(ch) ?? ch;
}

export function fold(text) {
    return [...text].map(foldChar).join('');
}

// A word character for boundary purposes. Deliberately Unicode-aware:
// the poems are full of words like "men’s" and "Chaumont".
function isWordChar(ch) {
    return ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
}

function decodeEntity(raw) {
    const known = ENTITIES.get(raw.toLowerCase());
    if (known) return known;
    const numeric = raw.match(/^&#(x?)([0-9a-f]+);$/i);
    if (numeric) {
        const code = parseInt(numeric[2], numeric[1] ? 16 : 10);
        if (Number.isFinite(code)) return String.fromCodePoint(code);
    }
    return null;
}

/**
 * Splits a line of HTML into a flat list of pieces, where every piece
 * that carries visible text contributes exactly one entry per character.
 *
 * Working per character rather than per string is what lets a match be
 * split at a tag boundary without ever guessing where inside the raw
 * markup a plain-text offset lands - an entity like "&amp;" is one
 * character of text and five of markup.
 *
 * @param {string} html
 * @returns {Array<{ kind: 'tag'|'char', raw: string, ch?: string }>}
 */
export function pieces(html) {
    const out = [];
    let index = 0;
    for (const tag of html.matchAll(TAG_RE)) {
        pushText(out, html.slice(index, tag.index));
        out.push({ kind: 'tag', raw: tag[0] });
        index = tag.index + tag[0].length;
    }
    pushText(out, html.slice(index));
    return out;
}

function pushText(out, text) {
    let index = 0;
    for (const entity of text.matchAll(ENTITY_RE)) {
        for (const ch of text.slice(index, entity.index)) out.push({ kind: 'char', raw: ch, ch });
        const decoded = decodeEntity(entity[0]);
        if (decoded === null) {
            // Unrecognised - treat it as literal characters rather than
            // pretend it is one.
            for (const ch of entity[0]) out.push({ kind: 'char', raw: ch, ch });
        } else {
            out.push({ kind: 'char', raw: entity[0], ch: decoded });
        }
        index = entity.index + entity[0].length;
    }
    for (const ch of text.slice(index)) out.push({ kind: 'char', raw: ch, ch });
}

/**
 * Every whole-word, case-sensitive occurrence of `phrase` in the visible
 * text of `html`.
 *
 * @param {string} html - one rendered line, tags and all.
 * @param {string} phrase - the anchor text from the ledger.
 * @returns {Array<{ start: number, end: number }>} character offsets into the visible text.
 */
export function findPhrase(html, phrase) {
    const parts = pieces(html);
    const chars = parts.filter((p) => p.kind === 'char');
    const text = fold(chars.map((p) => p.ch).join(''));
    const needle = fold(phrase);
    if (!needle) return [];

    const found = [];
    let from = 0;
    for (;;) {
        const at = text.indexOf(needle, from);
        if (at === -1) break;
        const before = text[at - 1];
        const after = text[at + needle.length];
        const wholeWord =
            !(isWordChar(before) && isWordChar(needle[0])) &&
            !(isWordChar(after) && isWordChar(needle[needle.length - 1]));
        if (wholeWord) found.push({ start: at, end: at + needle.length });
        from = at + 1;
    }
    return found;
}

/**
 * Applies an anchor across a whole rendered poem body.
 *
 * Uniqueness is judged over the whole poem rather than one line: an
 * anchor that appears on two different lines is exactly as ambiguous as
 * one that appears twice on the same line, and the poet needs to hear
 * about both the same way.
 *
 * Matching still happens line by line, so a phrase can never
 * accidentally run from the end of one line, through the line-number
 * markup of the next, and into the following verse.
 *
 * @param {string} body - the rendered poem, newline separated.
 * @param {string} phrase
 * @param {string} hrefAttr - already encoded and HTML-escaped.
 * @returns {{ ok: boolean, body: string, count: number, reason?: string }}
 */
export function linkPhraseInBody(body, phrase, hrefAttr) {
    const lines = body.split('\n');
    const hits = lines.map((line) => findPhrase(line, phrase).length);
    const total = hits.reduce((sum, n) => sum + n, 0);

    if (total === 0) return { ok: false, body, count: 0, reason: 'not found' };
    if (total > 1) {
        return {
            ok: false,
            body,
            count: total,
            reason: `appears ${total} times — lengthen the phrase until it is unique`,
        };
    }

    const at = hits.findIndex((n) => n === 1);
    const result = linkPhrase(lines[at], phrase, hrefAttr);
    if (!result.ok) return { ok: false, body, count: result.count, reason: result.reason };

    lines[at] = result.html;
    return { ok: true, body: lines.join('\n'), count: 1 };
}

/**
 * Applies an anchor across several regions of one poem's page.
 *
 * A poem is written into the template in more than one piece - the verse
 * and, separately, its footnotes - and links belong in both: the
 * hand-made SNAFU linked Fussell's name inside a citation. Uniqueness is
 * judged over all of them together, so an anchor appearing once in the
 * verse and once in a footnote is ambiguous rather than quietly applied
 * to whichever happened to be searched first.
 *
 * @param {Record<string, string>} regions - named chunks of rendered HTML.
 * @param {string} phrase
 * @param {string} hrefAttr - already encoded and HTML-escaped.
 * @returns {{ ok: boolean, regions: Record<string, string>, count: number, reason?: string }}
 */
export function linkPhraseAcross(regions, phrase, hrefAttr) {
    const counts = Object.fromEntries(
        Object.entries(regions).map(([name, html]) => [
            name,
            html.split('\n').reduce((sum, line) => sum + findPhrase(line, phrase).length, 0),
        ])
    );
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);

    if (total === 0) return { ok: false, regions, count: 0, reason: 'not found' };
    if (total > 1) {
        return {
            ok: false,
            regions,
            count: total,
            reason: `appears ${total} times — lengthen the phrase until it is unique`,
        };
    }

    const name = Object.keys(counts).find((key) => counts[key] === 1);
    const result = linkPhraseInBody(regions[name], phrase, hrefAttr);
    if (!result.ok) return { ok: false, regions, count: result.count, reason: result.reason };

    return { ok: true, regions: { ...regions, [name]: result.body }, count: 1 };
}

/**
 * Wraps one occurrence of `phrase` in `html` with a link.
 *
 * A phrase routinely spans several elements - a whole quoted stanza is
 * one italic run per line, and a line can be several spans - so the
 * anchor is re-opened around each fragment rather than wrapped once
 * across a tag boundary, which would split a tag across the link. That
 * is the same rule renderSegments already follows for links crossing a
 * soft line break, and it renders as one continuous link.
 *
 * @param {string} html
 * @param {string} phrase
 * @param {string} hrefAttr - already encoded and HTML-escaped.
 * @returns {{ ok: boolean, html: string, count: number, reason?: string }}
 */
export function linkPhrase(html, phrase, hrefAttr) {
    const found = findPhrase(html, phrase);
    if (found.length === 0) {
        return { ok: false, html, count: 0, reason: 'not found' };
    }
    if (found.length > 1) {
        return {
            ok: false,
            html,
            count: found.length,
            reason: `appears ${found.length} times — lengthen the phrase until it is unique`,
        };
    }

    const { start, end } = found[0];
    const parts = pieces(html);

    // An anchor inside an anchor is invalid markup and the browser
    // silently unnests it, so the inner link simply disappears.
    let depth = 0;
    let textIndex = 0;
    for (const part of parts) {
        if (part.kind === 'tag') {
            if (/^<a[\s>]/i.test(part.raw)) depth += 1;
            else if (/^<\/a\s*>/i.test(part.raw)) depth -= 1;
            continue;
        }
        if (textIndex >= start && textIndex < end && depth > 0) {
            return { ok: false, html, count: 1, reason: 'already inside a link' };
        }
        textIndex += 1;
    }

    const open = `<a href="${hrefAttr}">`;
    let out = '';
    let inside = false;
    textIndex = 0;
    for (const part of parts) {
        if (part.kind === 'tag') {
            // Close the anchor before a tag and reopen after it, so the
            // link never straddles an element boundary.
            if (inside) {
                out += '</a>';
                inside = false;
            }
            out += part.raw;
            continue;
        }
        const covered = textIndex >= start && textIndex < end;
        if (covered && !inside) {
            out += open;
            inside = true;
        }
        out += part.raw;
        textIndex += 1;
        if (inside && textIndex >= end) {
            out += '</a>';
            inside = false;
        }
    }
    if (inside) out += '</a>';

    return { ok: true, html: out, count: 1 };
}

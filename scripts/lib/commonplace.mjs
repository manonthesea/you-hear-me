// The Commonplace Book: the collection's own index of itself.
//
// It reads the ledger rather than the pages. Reading every <a href>
// on every page - as the map this replaced did - counts plates,
// hand-made pages and outbound links alike, and so answers a question
// nobody asked. The ledger is the record of what the poet deliberately
// drew between poems, so it is the only source that can answer "how
// does this collection refer to itself" without inflating the answer.
//
// The page is generated rather than written because the alternative was
// a snapshot that went stale the moment a link was added, and quietly:
// a map that is merely out of date looks exactly like a correct one.

import path from 'node:path';
import { isPoem } from './manifest.mjs';

// The folders are named for their era, with a punctuation mark that
// keeps them sorting in order on disk. The reader does not need to see
// the mark.
//
// This used to be a written-out list of the six eras that existed when
// the page was built, and the map drew only those - so the morning a
// seventh folder arrived from Drive, its poem was in the data, had a
// card nobody drew, and lost the one thread pointing at it. A list of
// what exists has to be read from what exists.

/**
 * The reader's name for an era folder.
 *
 * @param {string} folder - the top-level folder name, e.g. "2018-2019&".
 */
export function eraLabel(folder) {
    if (folder === '$Pre-2010') return 'Before 2010';
    return folder
        .replace(/[^\w\s-]+$/, '')           // the sorting mark
        .replace(/(\d{4})-(\d{4})/, '$1\u2013$2'); // a span takes an en dash
}

/**
 * The eras these poems occupy, in reading order.
 *
 * Before 2010 leads, then the spans by their first year. Anything whose
 * name carries no year sorts last rather than being dropped - being
 * unrecognised is not a reason to go missing from the map.
 *
 * @param {Array<{ era: string }>} poems
 * @returns {Array<{ key: string, label: string }>}
 */
export function erasIn(poems) {
    const seen = [...new Set(poems.map((p) => p.era))];
    const rank = (era) => {
        if (era === '$Pre-2010') return -Infinity;
        const year = era.match(/\d{4}/);
        return year ? Number(year[0]) : Infinity;
    };
    seen.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    return seen.map((key) => ({ key, label: eraLabel(key) }));
}

/**
 * A sortable key for a poem, from the filename its Doc was published at.
 *
 * Most are dates - "2.4.21", or "1.27.21a" where three poems share one.
 * The rest are "Circa" something, which places them roughly or not at
 * all; those sort to the end rather than pretending to a precision the
 * poet declined to give.
 *
 * @param {string} base - filename without extension.
 * @returns {{ sortKey: string, dated: boolean }}
 */
export function dateKey(base) {
    const m = base.match(/^(\d{1,2})\.(\d{1,2})\.(\d{1,4})([a-z])?$/);
    if (m) {
        let [, mo, da, yr, suffix] = m;
        // Two-digit years: everything here is 1990s or later, and a
        // collection that runs to 2025 has no 20xx/19xx ambiguity below 50.
        if (yr.length <= 2) yr = Number(yr) < 50 ? '20' + yr.padStart(2, '0') : '19' + yr;
        return {
            sortKey: `${yr.padStart(4, '0')}-${mo.padStart(2, '0')}-${da.padStart(2, '0')}${suffix ?? ''}`,
            dated: true,
        };
    }
    const circa = base.match(/Circa (\d{4})/);
    if (circa) return { sortKey: `${circa[1]}-06-15`, dated: false };
    return { sortKey: `9999-${base}`, dated: false };
}

/**
 * Everything the page needs, shaped from what the sync actually
 * published and what the ledger actually says.
 *
 * @param {{
 *   ledger: { poems: Map, embeds: Map },
 *   entries: Array<{id: string, path: string}>,   // manifest, plates included
 *   bySource: Map<string, Array<object>>,          // from resolveLedger
 *   titles: Map<string, string>,                   // repo path -> <h1>
 * }} input
 * @returns {{ poems: Array<object>, edges: Array<object> }}
 */
export function buildDataset({ ledger, entries, bySource, titles }) {
    const slugByDoc = new Map([...ledger.poems].map(([slug, v]) => [v.doc, slug]));

    const poems = [];
    for (const entry of entries) {
        // Plates are pages too, but they are not poems and nothing cites
        // them by name; they appear on a poem's card as "links out".
        if (!isPoem(entry)) continue;
        const base = path.posix.basename(entry.path, '.html');
        const { sortKey, dated } = dateKey(base);
        const slug = slugByDoc.get(entry.id) ?? null;
        poems.push({
            // A poem with no ledger entry still belongs on the map - it
            // is published, and its absence from the web is the point.
            key: slug ?? '_' + entry.path,
            slug,
            title: titles.get(entry.path) ?? base,
            era: entry.path.split('/')[0],
            path: entry.path,
            base,
            sortKey,
            dated,
            extras: [],
        });
    }

    const keyByPath = new Map(poems.map((p) => [p.path, p.key]));
    const byKey = new Map(poems.map((p) => [p.key, p]));

    const edges = [];
    for (const [sourcePath, links] of bySource) {
        const from = keyByPath.get(sourcePath);
        if (!from) continue;
        for (const link of links) {
            const t = link.target;
            // A portal is a thread between poems that happens to pass
            // through a picture, so it belongs in the graph exactly as a
            // plain link does. This is the whole reason "via" exists
            // rather than reusing "asset".
            if (t.kind === 'poem' || t.kind === 'portal') {
                const to = keyByPath.get(t.path);
                if (to) edges.push({ from, to, phrase: link.phrase });
            } else {
                // Everything that leaves the web of poems: a picture on a
                // plate, a picture on someone else's server, a page
                // elsewhere entirely. Kept on the card, out of the graph.
                const kind =
                    t.kind === 'external' ? 'external' : t.kind === 'embed' ? 'picture' : 'image';
                byKey.get(from)?.extras.push({ kind, phrase: link.phrase });
            }
        }
    }

    return { poems, edges, eras: erasIn(poems) };
}

/**
 * @param {{poems: Array, edges: Array}} data
 * @returns {string} the one-sentence description, generated so its
 *   numbers can never disagree with the map they describe.
 */
export function describe({ poems, edges }) {
    const years = poems
        .map((p) => Number(p.sortKey.slice(0, 4)))
        .filter((y) => y >= 1990 && y <= 2030);
    const span = years.length ? `${Math.min(...years)}–${Math.max(...years)}` : '';
    return (
        `An interactive map of how ${poems.length} poems in the you-hear-me collection ` +
        `cite, echo and answer one another${span ? `, ${span}` : ''}.`
    );
}

/**
 * @param {string} template - templates/commonplace-template.html
 * @param {{poems: Array, edges: Array, siteRoot?: string}} input
 *   siteRoot is "" for the copy that lives beside the poems in the repo,
 *   and the live site's URL for a copy hosted anywhere else.
 * @returns {string}
 */
export function renderCommonplace(template, { poems, edges, eras, siteRoot = '' }) {
    // The eras travel with the data. The page used to hold its own copy
    // of the list, which is one place too many for a fact that changes
    // whenever a folder does.
    const data = JSON.stringify({ poems, edges, eras: eras ?? erasIn(poems) });
    // The JSON sits inside a <script> block, where the parser is looking
    // for "</script" and nothing else. No poem title contains one, but
    // the page should not depend on that staying true.
    const safe = data.replace(/<\/script/gi, '<\\/script');
    return template
        .replace('{{DATA}}', () => safe)
        .replace('{{SITE_ROOT}}', () => siteRoot)
        .replace('{{DESCRIPTION}}', () => describe({ poems, edges }));
}

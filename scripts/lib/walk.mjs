// The Paths: the same links as the Commonplace Book, walked instead of
// mapped. Named walk.mjs because paths.mjs is the Drive-to-repo path
// mapper and has been since the first sync - two different senses of
// the word, and only one of them belongs to this page.
//
// The map answers "how does this collection refer to itself" all at
// once. It cannot answer "where does this poem take me, and then where"
// - a question about sequence, which a picture of everything is the
// wrong shape for. So this reads the same dataset and lets a reader
// take one step at a time.
//
// The graph loops: thirteen cycles run through it, several returning to
// the poem the walk starts from, and twenty-seven poems can be reached
// by more than one route. That is not a defect to be pruned into a
// tree - a path that comes back to where it began is the most
// interesting thing the collection does - so the walk is a walk, and
// arriving somewhere you have already been is reported rather than
// hidden.

// Where a reader starts unless they choose otherwise. Bound by slug,
// which is renameable - so if it ever stops resolving, the walk begins
// from the poem that leads to the most places instead of nowhere, and
// a test says the preferred one has gone missing.
export const DEFAULT_ROOT = 'its-okay-if-it-doesnt-make-sense-at-firs';

/**
 * Poem key -> the edges leading out of it, in the order given.
 *
 * @param {Array<{ from: string, to: string, phrase: string }>} edges
 * @returns {Map<string, Array<object>>}
 */
export function outgoing(edges) {
    const out = new Map();
    for (const edge of edges) {
        if (!out.has(edge.from)) out.set(edge.from, []);
        out.get(edge.from).push(edge);
    }
    return out;
}

/**
 * The poem a walk starts from.
 *
 * @param {Array<{ key: string }>} poems
 * @param {Array<object>} edges
 * @param {string} [preferred] - a slug to use if it is present and leads anywhere.
 */
export function chooseRoot(poems, edges, preferred = DEFAULT_ROOT) {
    const out = outgoing(edges);
    const has = new Set(poems.map((p) => p.key));
    if (has.has(preferred) && (out.get(preferred) ?? []).length) return preferred;

    // Falling back to the busiest poem rather than the first one: a root
    // with no way out is a walk that ends before it starts.
    let best = null;
    let most = -1;
    for (const poem of poems) {
        const n = (out.get(poem.key) ?? []).length;
        if (n > most) { most = n; best = poem.key; }
    }
    return best;
}

/**
 * Everywhere a walk from `root` can get to, and how far.
 *
 * Breadth-first, so `depth` is the fewest steps to each poem - the
 * length of the shortest path, not of some path.
 *
 * @returns {{ reached: Set<string>, depth: Map<string, number>, furthest: number }}
 */
export function reachable(root, edges) {
    const out = outgoing(edges);
    const depth = new Map([[root, 0]]);
    const queue = [root];

    for (let i = 0; i < queue.length; i += 1) {
        const here = queue[i];
        for (const edge of out.get(here) ?? []) {
            if (depth.has(edge.to)) continue;
            depth.set(edge.to, depth.get(here) + 1);
            queue.push(edge.to);
        }
    }

    return { reached: new Set(depth.keys()), depth, furthest: Math.max(...depth.values(), 0) };
}

/**
 * The sentence under the title, generated so its numbers cannot drift
 * out of step with the walk underneath them.
 */
export function describe({ poems, edges, root }) {
    const { reached, furthest } = reachable(root, edges);
    const title = poems.find((p) => p.key === root)?.title ?? 'the first poem';
    return (
        `A walk through the you-hear-me collection, one link at a time. ` +
        `Starting from "${title}", ${reached.size} of ${poems.length} poems ` +
        `lie along some path, the furthest ${furthest} steps out.`
    );
}

/**
 * Fills the template. The data is embedded rather than fetched so the
 * page is one file that works from disk, the way the map does.
 */
export function renderPaths(template, { poems, edges, root, siteRoot = '' }) {
    const data = JSON.stringify({ poems, edges, root });
    // The JSON sits inside a <script> block, where the parser looks for
    // "</script" and nothing else.
    const safe = data.replace(/<\/script/gi, '<\\/script');
    return template
        .replace('{{DATA}}', () => safe)
        .replace('{{SITE_ROOT}}', () => siteRoot)
        .replace('{{DESCRIPTION}}', () => describe({ poems, edges, root }));
}

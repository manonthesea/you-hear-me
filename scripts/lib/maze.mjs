// The Maze: the whole reachable collection as a genealogy, laid out.
//
// The Paths walks one step at a time. This is the other half of the
// same question - not "where does this take me" but "where does all of
// it go", seen at once.
//
// The obvious way to build it is the wrong way. Unrolling every route
// into its own branch, stopping only when a branch revisits a poem on
// its own path, gives 14,232 nodes over 35 generations: not a maze, a
// wall. The collection is small; it is the looping that is enormous.
//
// So each poem takes its place once, at its shortest distance from the
// root, and the tree is the first way you can arrive anywhere. Every
// other link is real and is drawn - but as a line that leaves its poem
// and STOPS, because it leads to somewhere already standing in the
// maze. 48 poems, 6 generations, 47 lines of descent and 38 that
// return, six of them to the root itself.

/**
 * @param {{ poems: Array<object>, edges: Array<object>, root: string }} input
 * @returns {{
 *   nodes: Array<object>,      // {key, title, gen, row, parent, via}
 *   tree: Array<object>,       // {from, to, phrase} - lines of descent
 *   returns: Array<object>,    // {from, to, phrase} - lines that stop
 *   offPath: Array<object>,    // poems no path from the root reaches
 *   generations: number,
 *   rows: number,
 * }}
 */
export function buildMaze({ poems, edges, root }) {
    const byKey = new Map(poems.map((p) => [p.key, p]));
    const out = new Map();
    for (const edge of edges) {
        if (!out.has(edge.from)) out.set(edge.from, []);
        out.get(edge.from).push(edge);
    }

    // Each link out of a poem carries its number, counted in the order
    // the ledger gives them - which is the order The Paths numbers its
    // choices in. So the third line down from a poem here is the turn
    // you take by pressing 3 over there, whether it descends or doubles
    // back. One vocabulary across both pages.
    const numbered = new Map();
    for (const [key, list] of out) {
        list.forEach((edge, i) => numbered.set(edge, { ...edge, n: i + 1, of: list.length, key }));
    }
    const number = (edge) => numbered.get(edge) ?? { ...edge, n: 1, of: 1 };

    // --- who descends from whom -------------------------------------
    // Breadth-first, so a poem's parent is the first way you can reach
    // it and its generation is the fewest steps to get there. Depth-first
    // would give the same set of poems at wildly deeper generations,
    // depending only on which link happened to be tried first.
    const gen = new Map([[root, 0]]);
    const via = new Map();
    const children = new Map();
    const tree = [];
    const queue = [root];

    for (let i = 0; i < queue.length; i += 1) {
        const here = queue[i];
        for (const edge of out.get(here) ?? []) {
            if (gen.has(edge.to) || !byKey.has(edge.to)) continue;
            gen.set(edge.to, gen.get(here) + 1);
            via.set(edge.to, edge.phrase);
            if (!children.has(here)) children.set(here, []);
            children.get(here).push(edge.to);
            tree.push(number(edge));
            queue.push(edge.to);
        }
    }

    const descends = new Set(tree.map((e) => e.from + '\u0000' + e.to));
    const returns = edges
        .filter((e) => gen.has(e.from) && gen.has(e.to) && !descends.has(e.from + '\u0000' + e.to))
        .map(number);

    // --- where each one stands --------------------------------------
    // Leaves take the next free row; a parent sits centred between its
    // first and last child, which keeps a family together and the lines
    // of descent short.
    const row = new Map();
    let next = 0;
    (function place(key) {
        const kids = children.get(key) ?? [];
        if (!kids.length) {
            row.set(key, next);
            next += 1;
            return row.get(key);
        }
        const kidRows = kids.map(place);
        row.set(key, (kidRows[0] + kidRows[kidRows.length - 1]) / 2);
        return row.get(key);
    })(root);

    // Centring a parent can land it on top of another poem in its own
    // generation, because the subtrees either side are different sizes.
    // Push down whatever overlaps, in order, so nothing is hidden behind
    // anything else.
    const byGen = new Map();
    for (const [key, g] of gen) {
        if (!byGen.has(g)) byGen.set(g, []);
        byGen.get(g).push(key);
    }
    for (const column of byGen.values()) {
        column.sort((a, b) => row.get(a) - row.get(b));
        for (let i = 1; i < column.length; i += 1) {
            const gap = row.get(column[i]) - row.get(column[i - 1]);
            if (gap < 1) row.set(column[i], row.get(column[i - 1]) + 1);
        }
    }

    const nodes = [...gen.keys()]
        .map((key) => ({
            key,
            title: byKey.get(key)?.title ?? key,
            path: byKey.get(key)?.path ?? '',
            sortKey: byKey.get(key)?.sortKey ?? '',
            dated: byKey.get(key)?.dated ?? false,
            base: byKey.get(key)?.base ?? '',
            gen: gen.get(key),
            row: row.get(key),
            parent: [...children].find(([, ks]) => ks.includes(key))?.[0] ?? null,
            via: via.get(key) ?? null,
            leads: (out.get(key) ?? []).length,
        }))
        .sort((a, b) => a.gen - b.gen || a.row - b.row);

    return {
        nodes,
        tree,
        returns,
        offPath: poems.filter((p) => !gen.has(p.key)),
        generations: Math.max(...gen.values()) + 1,
        rows: Math.max(...row.values()) + 1,
    };
}

/** The line under the title, generated so its numbers cannot drift. */
export function describe(maze, rootTitle) {
    return (
        `Every poem reachable from "${rootTitle}", set out by how far it lies from it. ` +
        `${maze.nodes.length} poems over ${maze.generations} generations, ` +
        `${maze.tree.length} lines of descent and ${maze.returns.length} that double back.`
    );
}

export function renderMaze(template, { maze, root, siteRoot = '' }) {
    const data = JSON.stringify({ ...maze, root });
    const safe = data.replace(/<\/script/gi, '<\\/script');
    const rootTitle = maze.nodes.find((n) => n.key === root)?.title ?? root;
    return template
        .replace('{{DATA}}', () => safe)
        .replace('{{SITE_ROOT}}', () => siteRoot)
        .replace('{{DESCRIPTION}}', () => describe(maze, rootTitle));
}

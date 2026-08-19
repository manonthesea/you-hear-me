// The record of what the sync generated, and the only thing that
// authorises a deletion.
//
// It used to store paths alone, which meant the sync knew *where* a poem
// was published but not *which poem it was*. With no notion of identity
// it could not tell a Doc that had been renamed from one that had been
// unpublished - both simply looked like a path that stopped appearing.
// Entries now carry the Drive Doc ID, so identity survives every rename,
// retitle and move.
//
// Deletion still works off paths, because "a file this sync generated
// before and would not generate now" is exactly the right rule and the
// hand-made pages must stay untouchable.

/**
 * Reads either manifest shape.
 *
 * The old form is a bare list of paths, and has to keep parsing: the
 * first run after this change reads a manifest written by the previous
 * one.
 *
 * Malformed content THROWS rather than reading as empty. An empty
 * manifest is a meaningful state - it means "the sync has generated
 * nothing yet" - so treating a corrupt file as empty would make every
 * published page look like an orphan and delete the entire site in a
 * single commit. A missing file is the only thing that legitimately
 * means empty, and that is handled by the caller.
 *
 * @param {string} raw - contents of .poem-sync-manifest.json.
 * @returns {Array<{ id: string|null, path: string, permalink: string|null }>}
 * @throws if the content is not a manifest.
 */
export function parseManifest(raw) {
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        throw new Error(`Manifest is not valid JSON (${err.message}). Refusing to treat it as empty, which would delete every published page.`);
    }
    if (!parsed || !Array.isArray(parsed.pages)) {
        throw new Error('Manifest has no "pages" array. Refusing to treat it as empty, which would delete every published page.');
    }

    return parsed.pages
        .map((entry) => {
            if (typeof entry === 'string') {
                // Pre-identity manifest: location only.
                return { id: null, path: entry, permalink: null };
            }
            if (entry && typeof entry.path === 'string') {
                return {
                    id: typeof entry.id === 'string' ? entry.id : null,
                    path: entry.path,
                    permalink: typeof entry.permalink === 'string' ? entry.permalink : null,
                };
            }
            throw new Error(`Manifest entry is neither a path nor a {path} object: ${JSON.stringify(entry)}`);
        });
}

/**
 * @param {Array<{ id: string, path: string, permalink: string }>} entries
 * @returns {object} the JSON body to write, ordered so a re-run with no
 *   edits produces no diff.
 */
export function manifestBody(entries) {
    const pages = [...entries]
        .sort((a, b) => a.path.localeCompare(b.path))
        .map(({ id, path, permalink }) => ({ id, path, permalink }));
    return { pages };
}

/**
 * Every file the sync owns: each poem's page and its permalink.
 *
 * Orphan selection compares these lists between runs, so a permalink
 * whose poem was unpublished is cleaned up by exactly the same rule that
 * removes the poem's page - no separate bookkeeping that could drift.
 *
 * @param {Array<{ path: string, permalink: string|null }>} entries
 * @returns {string[]}
 */
export function generatedPaths(entries) {
    const paths = [];
    for (const entry of entries) {
        if (entry.path) paths.push(entry.path);
        if (entry.permalink) paths.push(entry.permalink);
    }
    return paths;
}

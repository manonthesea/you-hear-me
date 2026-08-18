// Mapping between Drive's folder tree and the repo's file layout.
//
// Folder structure is mirrored into the published URLs, so a Doc named
// "Marsh Voices" inside "Early Work" is published at
// "Early Work/Marsh Voices.html".

import path from 'node:path';

// Characters that are illegal or troublesome in paths and URLs. Drive
// allows plenty of them in file names; the repo does not.
const UNSAFE = /[/\\:*?"<>|#]/g;

// A Doc is published by annotating its *name* — "Marsh Voices (Publish)"
// — so publication state is visible at a glance in Drive's file list
// without opening anything. The annotation is stripped from the title
// and from the output filename.
//
// Anything not annotated is a draft and is never written into the repo:
// the repo is public and its history permanent, so an unpublished poem
// must not land in it at all.
const PUBLISH_ANNOTATION = /\s*\(\s*publish(?:ed)?\s*\)\s*/i;

/**
 * @param {string} docName - the Drive Doc's name.
 * @returns {{ title: string, published: boolean }}
 */
export function parseDocName(docName) {
    const published = PUBLISH_ANNOTATION.test(docName);
    const title = published ? docName.replace(PUBLISH_ANNOTATION, ' ').trim() : docName.trim();
    return { title, published };
}

export function sanitizeSegment(name) {
    return name.trim().replace(UNSAFE, '').replace(/\s+/g, ' ');
}

/**
 * @param {string[]} folderPath - folder names from the sync root down to the Doc.
 * @param {string} docName - the Doc's name.
 * @returns {{ dir: string, filePath: string }} repo-relative locations.
 */
export function outputPathFor(folderPath, docName) {
    const dir = folderPath.map(sanitizeSegment).filter(Boolean).join('/');
    const file = `${sanitizeSegment(docName)}.html`;
    return { dir, filePath: dir ? path.posix.join(dir, file) : file };
}

/**
 * Pages a previous sync generated that this one no longer would:
 * unpublished, renamed, moved, or deleted Docs.
 *
 * Deliberately derived from the previous manifest rather than from
 * scanning the repo, so a page the sync never created can never be
 * selected for deletion.
 *
 * @param {string[]} previousPages - paths from the last run's manifest.
 * @param {string[]} currentPages - paths written by this run.
 * @returns {string[]} paths to remove.
 */
export function selectOrphans(previousPages, currentPages) {
    const current = new Set(currentPages);
    return previousPages.filter((p) => !current.has(p));
}

/**
 * Two Docs can share a name in different folders — fine, since the paths
 * differ — but two Docs in the *same* folder, or names that sanitize to
 * the same string, would silently overwrite each other.
 *
 * @param {Array<{ id: string, name: string, filePath: string }>} entries
 * @returns {Array<{ filePath: string, names: string[] }>} collisions, empty if none.
 */
export function findCollisions(entries) {
    const byPath = new Map();
    for (const entry of entries) {
        const list = byPath.get(entry.filePath) ?? [];
        list.push(entry.name);
        byPath.set(entry.filePath, list);
    }
    return [...byPath.entries()]
        .filter(([, names]) => names.length > 1)
        .map(([filePath, names]) => ({ filePath, names }));
}

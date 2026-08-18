#!/usr/bin/env node
// Pulls poem Docs from a shared Google Drive folder tree, converts them
// to the site's canonical template, and writes the published ones into
// the repo. Run manually (npm run sync) or via the "Sync poems" GitHub
// Actions workflow.
//
// Required environment:
//   DRIVE_FOLDER_ID  - the shared Drive folder's file ID (the root of
//                      the tree; subfolders are walked recursively)
//
// Authenticates via Application Default Credentials - in the GitHub
// Actions workflow that's Workload Identity Federation (no static key
// involved, see docs/POEM_SYNC.md); locally it's whatever `gcloud auth
// application-default login` or GOOGLE_APPLICATION_CREDENTIALS points
// to on your machine.
//
// Two rules govern what reaches the site:
//   - Only Docs whose name is annotated "(Publish)" are written at all.
//     The repo is public, so an unpublished poem must never land in it.
//   - The output filename comes from the Doc's NAME, so the page's URL
//     is whatever the Doc is called in Drive and never depends on the
//     poem's text. The <h1> comes from the title written inside the Doc.
//   - Folder structure is mirrored into the URLs, and pages this script
//     generated previously but no longer would (unpublished, renamed,
//     deleted, or moved Docs) are removed.
//
// Only files whose rendered content actually changed are written, so a
// re-run with no edits in Docs produces no diff.

import { google } from 'googleapis';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertDocHtml, extractTitle } from './lib/convert.mjs';
import { findCollisions, outputPathFor, parseDocName, selectOrphans } from './lib/paths.mjs';
import { renderPage } from './lib/render.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const TEMPLATE_PATH = path.join(REPO_ROOT, 'templates', 'poem-template.html');
// Records the pages this script generated, so orphans can be removed
// without ever touching the hand-made pages that predate the sync.
const MANIFEST_PATH = path.join(REPO_ROOT, '.poem-sync-manifest.json');

const DOC_MIME = 'application/vnd.google-apps.document';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

function requireEnv(name) {
    const value = process.env[name];
    if (!value) {
        console.error(`Missing required environment variable: ${name}`);
        process.exit(1);
    }
    return value;
}

// A Doc that doesn't open with its title would otherwise donate its
// first line of verse as one. Nothing can detect that reliably, but an
// implausibly long "title" is a good signal, and falling back to the
// Doc's name keeps the <h1> sensible. Only the <h1> is at stake here —
// the filename comes from the Doc's name regardless.
const MAX_TITLE_LENGTH = 80;

function chooseTitle(firstLine, docName) {
    if (firstLine && firstLine.length <= MAX_TITLE_LENGTH) return firstLine;
    return docName;
}

function getAuth() {
    return new google.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });
}

async function listChildren(drive, folderId) {
    const files = [];
    let pageToken;
    do {
        const res = await drive.files.list({
            q: `'${folderId}' in parents and trashed=false`,
            fields: 'nextPageToken, files(id, name, mimeType)',
            pageSize: 200,
            pageToken,
        });
        files.push(...res.data.files);
        pageToken = res.data.nextPageToken;
    } while (pageToken);
    return files;
}

// Walks the folder tree breadth-first, returning every Doc with the
// folder path it was found under.
async function collectDocs(drive, rootId) {
    const docs = [];
    const queue = [{ id: rootId, folderPath: [] }];
    const seenFolders = new Set([rootId]);

    while (queue.length > 0) {
        const { id, folderPath } = queue.shift();
        const children = await listChildren(drive, id);
        for (const child of children) {
            if (child.mimeType === FOLDER_MIME) {
                // Drive allows a file in multiple parents; guard against
                // walking the same folder (or a cycle) twice.
                if (seenFolders.has(child.id)) continue;
                seenFolders.add(child.id);
                queue.push({ id: child.id, folderPath: [...folderPath, child.name] });
            } else if (child.mimeType === DOC_MIME) {
                docs.push({ id: child.id, name: child.name, folderPath });
            }
        }
    }
    return docs;
}

async function exportDocHtml(drive, fileId) {
    const res = await drive.files.export(
        { fileId, mimeType: 'text/html' },
        { responseType: 'text' }
    );
    return typeof res.data === 'string' ? res.data : String(res.data);
}

async function readManifest() {
    try {
        const raw = await readFile(MANIFEST_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed.pages) ? parsed.pages : [];
    } catch {
        return []; // first run, or manifest removed
    }
}

async function writeManifest(pages) {
    const body = { pages: [...pages].sort() };
    await writeFile(MANIFEST_PATH, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
}

// Removes pages that a previous sync generated but this one did not.
// Selection lives in paths.mjs so it can be tested directly — this is
// the only code that deletes anything.
async function removeOrphans(previousPages, currentPages) {
    const orphans = selectOrphans(previousPages, currentPages);
    for (const orphan of orphans) {
        await rm(path.join(REPO_ROOT, orphan), { force: true });
        console.log(`Removed ${orphan} (no longer published)`);
    }
    return orphans.length;
}

async function main() {
    const folderId = requireEnv('DRIVE_FOLDER_ID');
    const auth = getAuth();
    const drive = google.drive({ version: 'v3', auth });

    console.log(`Walking Drive folder tree from ${folderId}...`);
    const allDocs = await collectDocs(drive, folderId);
    console.log(`Found ${allDocs.length} Doc(s) across the tree.`);
    if (allDocs.length === 0) {
        console.log('Nothing to sync.');
        return;
    }

    // The "(Publish)" annotation lives in the Doc's name, so publication
    // state and the clean title both come from parsing it.
    const parsed = allDocs.map((doc) => {
        const { title, published } = parseDocName(doc.name);
        // The path comes from the Doc's name, so it is known before any
        // Doc is opened and cannot be changed by editing the poem.
        return { ...doc, docTitle: title, published, ...outputPathFor(doc.folderPath, title) };
    });

    const published = parsed.filter((d) => d.published);
    const drafts = parsed.length - published.length;

    const template = await readFile(TEMPLATE_PATH, 'utf8');
    const previousPages = await readManifest();

    const publishedPages = [];
    let created = 0;
    let updated = 0;
    let unchanged = 0;
    let failed = 0;

    // Pass 1: export each published Doc and read the title written
    // inside it. Paths are already known from the Doc names, but the
    // exports are gathered here so pass 2 renders with every poem's path
    // available for cross-poem links.
    const exported = [];
    for (const doc of published) {
        try {
            const html = await exportDocHtml(drive, doc.id);
            const title = chooseTitle(extractTitle(html), doc.docTitle);
            exported.push({ ...doc, html, title });
            console.log(`${doc.filePath}  <-  "${doc.name}"  title: "${title}"`);
        } catch (err) {
            failed += 1;
            console.error(`Failed to export "${doc.name}" (${doc.id}):`, err.message);
        }
    }

    const collisions = findCollisions(exported);
    if (collisions.length > 0) {
        console.error('Output path collisions — two poems would write the same file:');
        for (const { filePath, names } of collisions) {
            console.error(`  ${filePath} <- ${names.join(', ')}`);
        }
        console.error('Rename one Doc of each pair, then re-run.');
        process.exit(1);
    }

    // Cross-poem links resolve against published poems only; a link to a
    // draft would otherwise point at a page that does not exist.
    const docIdToPath = new Map(exported.map((d) => [d.id, d.filePath]));

    // Pass 2: render and write.
    for (const doc of exported) {
        try {
            const { body, date, unresolved, footnotesHtml, orphanFootnoteRefs } = convertDocHtml(
                doc.html,
                doc.title,
                docIdToPath,
                doc.dir
            );

            for (const number of orphanFootnoteRefs) {
                console.warn(
                    `  note: "${doc.title}" references footnote ${number} but its citation ` +
                        "text didn't come through — check the Doc's footnote"
                );
            }

            for (const text of unresolved) {
                console.warn(
                    `  note: "${doc.title}" links to an unpublished poem ("${text}") — ` +
                        'link dropped, words kept'
                );
            }

            const page = renderPage(template, {
                title: doc.title,
                body,
                date,
                dir: doc.dir,
                footnotesHtml,
            });

            const outputPath = path.join(REPO_ROOT, doc.filePath);
            let existing = null;
            try {
                existing = await readFile(outputPath, 'utf8');
            } catch {
                // file doesn't exist yet
            }

            publishedPages.push(doc.filePath);

            if (existing === page) {
                unchanged += 1;
                continue;
            }

            if (doc.dir) await mkdir(path.dirname(outputPath), { recursive: true });
            await writeFile(outputPath, page, 'utf8');
            if (existing === null) {
                created += 1;
                console.log(`Created ${doc.filePath}`);
            } else {
                updated += 1;
                console.log(`Updated ${doc.filePath}`);
            }
        } catch (err) {
            failed += 1;
            console.error(`Failed to write "${doc.title}" (${doc.id}):`, err.message);
        }
    }

    // A failed export would otherwise look like an unpublished poem and
    // get its page deleted. Leave the previous state alone instead.
    let removed = 0;
    if (failed === 0) {
        removed = await removeOrphans(previousPages, publishedPages);
        await writeManifest(publishedPages);
    } else {
        console.error('\nSkipping orphan cleanup because some Docs failed to sync.');
    }

    console.log(
        `\nSync complete: ${created} created, ${updated} updated, ${unchanged} unchanged, ` +
            `${removed} removed, ${drafts} draft(s) skipped, ${failed} failed.`
    );
    if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

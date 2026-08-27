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
import { existsSync } from 'node:fs';
import { linkPhraseAcross } from './lib/anchor.mjs';
import { hrefFor, parseLedger, resolveLedger } from './lib/ledger.mjs';
import { platePath, plateSlug, renderPlate } from './lib/plate.mjs';
import { PLATE_PREFIX, generatedPaths, manifestBody, parseManifest } from './lib/manifest.mjs';
import { findCollisions, outputPathFor, parseDocName, selectOrphans } from './lib/paths.mjs';
import {
    findPermalinkCollisions,
    permalinkId,
    permalinkPath,
    renderPermalink,
} from './lib/permalink.mjs';
import { renderPage } from './lib/render.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const TEMPLATE_PATH = path.join(REPO_ROOT, 'templates', 'poem-template.html');
// Records the pages this script generated, so orphans can be removed
// without ever touching the hand-made pages that predate the sync.
const MANIFEST_PATH = path.join(REPO_ROOT, '.poem-sync-manifest.json');
// The web of cross-poem links, kept here rather than inside the Docs.
const LEDGER_PATH = path.join(REPO_ROOT, 'links.yml');

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
    let raw;
    try {
        raw = await readFile(MANIFEST_PATH, 'utf8');
    } catch (err) {
        if (err.code === 'ENOENT') return []; // first run, or manifest removed
        throw err;
    }
    // A parse failure deliberately propagates: see parseManifest.
    return parseManifest(raw);
}

async function writeManifest(entries) {
    const body = manifestBody(entries);
    await writeFile(MANIFEST_PATH, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
}

// Removes pages that a previous sync generated but this one did not.
// Selection lives in paths.mjs so it can be tested directly — this is
// the only code that deletes anything.
async function removeOrphans(previousEntries, currentEntries) {
    const orphans = selectOrphans(generatedPaths(previousEntries), generatedPaths(currentEntries));
    for (const orphan of orphans) {
        await rm(path.join(REPO_ROOT, orphan), { force: true });
        console.log(`Removed ${orphan} (no longer published)`);
        // A permalink is its own directory; leave nothing behind but
        // never touch a directory that still holds something.
        if (orphan.startsWith('p/')) {
            await rm(path.join(REPO_ROOT, path.dirname(orphan)), { force: true }).catch(() => {});
        }
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
    const previousEntries = await readManifest();

    const publishedEntries = [];
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

    // Two poems sharing a permalink would leave one unreachable by its
    // permanent URL, decided by write order. Refuse rather than pick.
    const permalinkCollisions = findPermalinkCollisions(exported);
    if (permalinkCollisions.length > 0) {
        console.error('Permalink collisions — two poems would share one permanent URL:');
        for (const { permalink, filePaths } of permalinkCollisions) {
            console.error(`  p/${permalink}/ <- ${filePaths.join(', ')}`);
        }
        process.exit(1);
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

    // A mistake IN the ledger - an unknown slug, a link with nowhere to
    // point - is a typo in a version-controlled file and stops the run
    // before anything is written. A poem that is merely unpublished is
    // not a mistake, and is reported further down instead.
    let ledgerLinks = new Map();
    let ledgerPending = [];
    let ledgerMissingAssets = [];
    let ledgerAssets = new Map();
    let ledgerEmbeds = new Map();
    // Resolves an overlay's "to:" slug to the page it was published at.
    let pathForSlug = () => undefined;
    const plates = new Map();
    if (existsSync(LEDGER_PATH)) {
        const ledger = parseLedger(await readFile(LEDGER_PATH, 'utf8'));
        ledgerAssets = ledger.assets;
        ledgerEmbeds = ledger.embeds;
        pathForSlug = (slug) => docIdToPath.get(ledger.poems.get(slug)?.doc);
        const resolved = resolveLedger(ledger, {
            pathForDoc: (docId) => docIdToPath.get(docId),
            assetExists: (rel) => existsSync(path.join(REPO_ROOT, rel)),
        });
        ledgerLinks = resolved.bySource;
        ledgerPending = resolved.pending;
        ledgerMissingAssets = resolved.missingAssets;

        // Every image linked from a poem gets a plate: a black page
        // holding just that image, so it can be clicked. The link in the
        // poem points at the plate rather than the bare file.
        for (const [sourcePath, links] of resolved.bySource) {
            for (const link of links) {
                if (link.target.kind === 'embed') {
                    // A picture on another server gets a plate too, keyed
                    // by its name since there is no file here to key on.
                    const name = link.target.name;
                    if (!plates.has(name)) plates.set(name, { asset: name, embed: name, back: sourcePath });
                    link.target = { kind: 'plate', path: platePath(plateSlug(name)) };
                    continue;
                }
                if (link.target.kind !== 'asset') continue;
                const asset = link.target.path;
                if (!plates.has(asset)) {
                    // The way back, for a reader with no scripting: the
                    // first poem that links this image.
                    plates.set(asset, { asset, back: sourcePath });
                }
                link.target = { kind: 'plate', path: platePath(plateSlug(asset)) };
            }
        }
        console.log(`Ledger: ${ledger.links.length} link(s) across ${ledger.poems.size} poem(s).`);
    }
    const anchorFailures = [];

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

            // Apply the ledger's links to this poem. An anchor that no
            // longer matches is collected rather than thrown: the poem's
            // words are still correct, only a link is missing, and
            // blocking the whole sync would let one stale phrase stop an
            // unrelated poem from publishing.
            // Both the verse and the footnotes: a citation is as
            // linkable as a line, and the hand-made pages linked inside
            // one.
            let regions = { body, footnotes: footnotesHtml };
            for (const link of ledgerLinks.get(doc.filePath) ?? []) {
                const href = hrefFor(link.target, doc.dir);
                const result = linkPhraseAcross(regions, link.phrase, href);
                if (result.ok) {
                    regions = result.regions;
                } else {
                    anchorFailures.push({ ...link, poem: doc.title, reason: result.reason });
                }
            }

            const page = renderPage(template, {
                title: doc.title,
                body: regions.body,
                date,
                dir: doc.dir,
                footnotesHtml: regions.footnotes,
            });

            const outputPath = path.join(REPO_ROOT, doc.filePath);
            let existing = null;
            try {
                existing = await readFile(outputPath, 'utf8');
            } catch {
                // file doesn't exist yet
            }

            const linkId = permalinkId(doc.id);
            const linkPath = permalinkPath(linkId);
            publishedEntries.push({ id: doc.id, path: doc.filePath, permalink: linkPath });

            if (existing === page) {
                unchanged += 1;
            } else {
                if (doc.dir) await mkdir(path.dirname(outputPath), { recursive: true });
                await writeFile(outputPath, page, 'utf8');
                if (existing === null) {
                    created += 1;
                    console.log(`Created ${doc.filePath}`);
                } else {
                    updated += 1;
                    console.log(`Updated ${doc.filePath}`);
                }
            }

            // The permalink redirects to wherever the poem currently
            // lives, so it is rewritten whenever that path changes.
            const stub = renderPermalink({ id: doc.id, title: doc.title, filePath: doc.filePath });
            const stubPath = path.join(REPO_ROOT, linkPath);
            let existingStub = null;
            try {
                existingStub = await readFile(stubPath, 'utf8');
            } catch {
                // no permalink for this poem yet
            }
            if (existingStub !== stub) {
                await mkdir(path.dirname(stubPath), { recursive: true });
                await writeFile(stubPath, stub, 'utf8');
                console.log(`${existingStub === null ? 'Created' : 'Updated'} ${linkPath}  (${doc.title})`);
            }
        } catch (err) {
            failed += 1;
            console.error(`Failed to write "${doc.title}" (${doc.id}):`, err.message);
        }
    }

    // Plates are written after the poems, so a plate's way back always
    // points at a page this run actually produced.
    const plateEntries = [];
    for (const { asset, back, embed } of plates.values()) {
        // An embedded picture is configured under its own name, and
        // always leads where the ledger said - there is no poem it
        // "came from" to fall back to.
        const config = (embed ? ledgerEmbeds.get(embed) : ledgerAssets.get(asset)) ?? {};
        const overlay = config.overlay
            ? {
                  image: config.overlay.image,
                  alt: config.overlay.alt ?? 'Go to the front page',
                  href: config.overlay.to ? pathForSlug(config.overlay.to) : config.overlay.href,
              }
            : null;
        const platePathFor = platePath(plateSlug(asset));
        // A pinned destination beats the poem the reader arrived from.
        const pinnedTo = config.to ? pathForSlug(config.to) : config.href ?? null;
        const page = renderPlate({
            asset,
            title: config.title ?? path.posix.basename(asset),
            back: pinnedTo ?? back,
            pinned: Boolean(pinnedTo),
            zoom: config.zoom ?? null,
            zoomOn: config.zoomOn ?? 'load',
            focus: config.focus ?? null,
            scroll: config.scroll ?? null,
            overlay,
            embed: embed ? { src: config.src, frame: config.frame, cover: config.cover } : null,
        });
        const outputPath = path.join(REPO_ROOT, platePathFor);
        let existing = null;
        try {
            existing = await readFile(outputPath, 'utf8');
        } catch {
            // no plate for this image yet
        }
        plateEntries.push({ id: `${PLATE_PREFIX}${asset}`, path: platePathFor, permalink: null });
        if (existing !== page) {
            await mkdir(path.dirname(outputPath), { recursive: true });
            await writeFile(outputPath, page, 'utf8');
            console.log(`${existing === null ? 'Created' : 'Updated'} ${platePathFor}  (${asset})`);
        }
    }
    publishedEntries.push(...plateEntries);

    // A failed export would otherwise look like an unpublished poem and
    // get its page deleted. Leave the previous state alone instead.
    let removed = 0;
    if (failed === 0) {
        removed = await removeOrphans(previousEntries, publishedEntries);
        await writeManifest(publishedEntries);
    } else {
        console.error('\nSkipping orphan cleanup because some Docs failed to sync.');
    }

    // Links the ledger could not place. Pages are already written -
    // the poem's words are correct either way - but the run goes red so
    // the failure arrives as an email rather than as a reader's dead
    // link months later.
    for (const link of ledgerPending) {
        console.warn(`  note: link "${link.phrase}" is waiting — ${link.why}`);
    }
    for (const link of ledgerMissingAssets) {
        console.error(`  ledger: ${link.where} — ${link.why}`);
    }
    for (const failure of anchorFailures) {
        console.error(
            `  ledger: "${failure.poem}" has no unique anchor for "${failure.phrase}" ` +
                `(${failure.reason})`
        );
    }

    const ledgerProblems = ledgerMissingAssets.length + anchorFailures.length;
    console.log(
        `\nSync complete: ${created} created, ${updated} updated, ${unchanged} unchanged, ` +
            `${removed} removed, ${drafts} draft(s) skipped, ${failed} failed.`
    );
    if (ledgerPending.length > 0 || ledgerProblems > 0) {
        console.log(
            `Ledger: ${ledgerPending.length} link(s) waiting on an unpublished poem, ` +
                `${ledgerProblems} needing attention.`
        );
    }
    if (failed > 0 || ledgerProblems > 0) process.exitCode = 1;
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

#!/usr/bin/env node
// Pulls every poem Doc from a shared Google Drive folder, converts it to
// the site's canonical template, and writes/updates the poem's HTML page
// at the repo root. Run manually (npm run sync) or via the
// "Sync poems" GitHub Actions workflow (workflow_dispatch).
//
// Required environment:
//   DRIVE_FOLDER_ID  - the shared Drive folder's file ID
//
// Authenticates via Application Default Credentials - in the GitHub
// Actions workflow that's Workload Identity Federation (no static key
// involved, see docs/POEM_SYNC.md); locally it's whatever `gcloud auth
// application-default login` or GOOGLE_APPLICATION_CREDENTIALS points
// to on your machine.
//
// Only files whose rendered content actually changed are written, so a
// re-run with no edits in Docs produces no diff.

import { google } from 'googleapis';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertDocHtml } from './lib/convert.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const TEMPLATE_PATH = path.join(REPO_ROOT, 'templates', 'poem-template.html');

function requireEnv(name) {
    const value = process.env[name];
    if (!value) {
        console.error(`Missing required environment variable: ${name}`);
        process.exit(1);
    }
    return value;
}

function sanitizeFilename(name) {
    return name.trim().replace(/[/\\:*?"<>|]/g, '');
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function getAuth() {
    return new google.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });
}

async function listPoemDocs(drive, folderId) {
    const files = [];
    let pageToken;
    do {
        const res = await drive.files.list({
            q: `'${folderId}' in parents and mimeType='application/vnd.google-apps.document' and trashed=false`,
            fields: 'nextPageToken, files(id, name, modifiedTime)',
            pageSize: 200,
            pageToken,
        });
        files.push(...res.data.files);
        pageToken = res.data.nextPageToken;
    } while (pageToken);
    return files;
}

async function exportDocHtml(drive, fileId) {
    const res = await drive.files.export(
        { fileId, mimeType: 'text/html' },
        { responseType: 'text' }
    );
    return typeof res.data === 'string' ? res.data : String(res.data);
}

async function main() {
    const folderId = requireEnv('DRIVE_FOLDER_ID');
    const auth = await getAuth();
    const drive = google.drive({ version: 'v3', auth });

    console.log(`Listing poem Docs in folder ${folderId}...`);
    const docs = await listPoemDocs(drive, folderId);
    if (docs.length === 0) {
        console.log('No Docs found in the folder. Nothing to sync.');
        return;
    }
    console.log(`Found ${docs.length} poem Doc(s).`);

    const docIdToFilename = new Map(
        docs.map((doc) => [doc.id, `${sanitizeFilename(doc.name)}.html`])
    );

    const template = await readFile(TEMPLATE_PATH, 'utf8');

    let created = 0;
    let updated = 0;
    let unchanged = 0;
    let failed = 0;

    for (const doc of docs) {
        const filename = docIdToFilename.get(doc.id);
        const outputPath = path.join(REPO_ROOT, filename);
        try {
            const html = await exportDocHtml(drive, doc.id);
            const { body, date } = convertDocHtml(html, doc.name, docIdToFilename);

            const page = template
                .replaceAll('{{TITLE}}', escapeHtml(doc.name))
                .replaceAll('{{BODY}}', body)
                .replaceAll('{{DATE}}', escapeHtml(date));

            let existing = null;
            try {
                existing = await readFile(outputPath, 'utf8');
            } catch {
                // file doesn't exist yet
            }

            if (existing === page) {
                unchanged += 1;
                continue;
            }

            await writeFile(outputPath, page, 'utf8');
            if (existing === null) {
                created += 1;
                console.log(`Created ${filename}`);
            } else {
                updated += 1;
                console.log(`Updated ${filename}`);
            }
        } catch (err) {
            failed += 1;
            console.error(`Failed to sync "${doc.name}" (${doc.id}):`, err.message);
        }
    }

    console.log(
        `\nSync complete: ${created} created, ${updated} updated, ${unchanged} unchanged, ${failed} failed.`
    );
    if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

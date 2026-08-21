#!/usr/bin/env node
// Scans every poem page for internal links (to other poems and to
// images) and generates graph.html: a map of the collection's "web of
// context" - the hyperlinks that connect poems and images into a single
// narrative. Run with `npm run graph`, or automatically after `npm run
// sync` in the GitHub Actions workflow.
//
// This also surfaces broken internal links (a poem linking to another
// poem/image reference that doesn't resolve to a real file) - those
// undermine the narrative web just as much as a missing page would.

import * as cheerio from 'cheerio';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif']);
const EXCLUDED_PAGES = new Set(['index.html', 'graph.html']);

function stripDiacritics(str) {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeForMatch(str) {
    return stripDiacritics(str)
        .replace(/[‘’]/g, "'")
        .replace(/[“”]/g, '"')
        .toLowerCase();
}

// Directories that hold machinery rather than poems.
const SKIP_DIRS = new Set([
    '.git',
    '.github',
    'node_modules',
    'assets',
    'templates',
    'scripts',
    'docs',
]);

// Poems now mirror their Drive folders, so pages live at any depth.
// Returns repo-relative POSIX paths.
async function listRepoFiles(dir = '') {
    const entries = await readdir(path.join(REPO_ROOT, dir), { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const rel = dir ? path.posix.join(dir, entry.name) : entry.name;
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue;
            // GitHub Pages runs Jekyll, which does not publish anything
            // whose name begins with an underscore. Indexing those would
            // fill the map with links the live site answers with a 404.
            if (entry.name.startsWith('_')) continue;
            files.push(...(await listRepoFiles(rel)));
        } else if (entry.isFile()) {
            files.push(rel);
        }
    }
    return files;
}

function resolveTarget(rawHref, poemFiles, poemMatchIndex, imageFiles, fromDir) {
    if (!rawHref) return { type: 'broken', target: rawHref };
    if (/^(mailto:|javascript:|#)/i.test(rawHref)) return { type: 'skip' };

    let href = rawHref;
    // Unwrap self-referential absolute GitHub Pages links to a relative path.
    const pagesMatch = href.match(
        /^https?:\/\/manonthesea\.github\.io\/you-hear-me\/(.+)$/i
    );
    if (pagesMatch) href = pagesMatch[1];

    if (/^https?:\/\//i.test(href)) {
        return { type: 'external', target: rawHref };
    }

    if (EXCLUDED_PAGES.has(path.posix.basename(decodeURIComponent(href.split('#')[0].split('?')[0])))) {
        return { type: 'skip' };
    }

    let decoded;
    try {
        decoded = decodeURIComponent(href);
    } catch {
        decoded = href;
    }
    decoded = decoded.split('#')[0].split('?')[0];

    // A link is relative to the page that contains it, so "../B.html" in
    // "Early/A.html" has to resolve to "B.html" at the root.
    const resolved = path.posix.normalize(
        fromDir ? path.posix.join(fromDir, decoded) : decoded
    );

    if (imageFiles.has(resolved)) return { type: 'image', target: resolved };

    const withHtml = resolved.toLowerCase().endsWith('.html') ? resolved : `${resolved}.html`;
    if (poemFiles.has(withHtml)) return { type: 'poem', target: withHtml };

    const fuzzyMatch = poemMatchIndex.get(normalizeForMatch(withHtml));
    if (fuzzyMatch) return { type: 'poem', target: fuzzyMatch };

    return { type: 'broken', target: rawHref };
}

async function main() {
    const allFiles = await listRepoFiles();
    const poemList = allFiles.filter(
        (f) => f.toLowerCase().endsWith('.html') && !EXCLUDED_PAGES.has(f)
    );
    const poemFiles = new Set(poemList);
    const poemMatchIndex = new Map(poemList.map((f) => [normalizeForMatch(f), f]));
    const imageFiles = new Set(
        allFiles.filter((f) => IMAGE_EXTENSIONS.has(path.extname(f).toLowerCase()))
    );

    const nodes = new Map(); // filename -> { title, date, outPoems: Set, outImages: Set, broken: [] }
    for (const file of poemList) {
        nodes.set(file, { title: file.replace(/\.html$/i, ''), date: '', outPoems: new Set(), outImages: new Set(), broken: [] });
    }

    for (const file of poemList) {
        const raw = await readFile(path.join(REPO_ROOT, file), 'utf8');
        const $ = cheerio.load(raw);
        const node = nodes.get(file);
        const h1 = $('h1').first().text().trim();
        if (h1) node.title = h1;
        const em = $('pre em, em.date').last().text().trim();
        if (em) node.date = em;

        $('a[href]').each((_, el) => {
            const href = $(el).attr('href');
            const resolved = resolveTarget(
                href,
                poemFiles,
                poemMatchIndex,
                imageFiles,
                path.posix.dirname(file) === '.' ? '' : path.posix.dirname(file)
            );
            if (resolved.type === 'poem' && resolved.target !== file) {
                node.outPoems.add(resolved.target);
            } else if (resolved.type === 'image') {
                node.outImages.add(resolved.target);
            } else if (resolved.type === 'broken') {
                node.broken.push(resolved.target);
            }
        });
    }

    const inbound = new Map(poemList.map((f) => [f, new Set()]));
    for (const [file, node] of nodes) {
        for (const target of node.outPoems) {
            inbound.get(target)?.add(file);
        }
    }

    const sorted = [...nodes.entries()].sort((a, b) =>
        a[1].title.localeCompare(b[1].title)
    );

    const totalLinks = sorted.reduce((n, [, node]) => n + node.outPoems.size, 0);
    const totalBroken = sorted.reduce((n, [, node]) => n + node.broken.length, 0);

    const entriesHtml = sorted
        .map(([file, node]) => {
            const inboundSet = inbound.get(file) ?? new Set();
            const rows = [];
            if (node.outPoems.size) {
                rows.push(
                    `<div class="edge-row"><span class="edge-label">leads to</span> ${[...node.outPoems]
                        .sort()
                        .map((t) => `<a href="${t}">${nodes.get(t)?.title ?? t.replace(/\.html$/i, '')}</a>`)
                        .join(', ')}</div>`
                );
            }
            if (inboundSet.size) {
                rows.push(
                    `<div class="edge-row"><span class="edge-label">referenced by</span> ${[...inboundSet]
                        .sort()
                        .map((t) => `<a href="${t}">${nodes.get(t)?.title ?? t.replace(/\.html$/i, '')}</a>`)
                        .join(', ')}</div>`
                );
            }
            if (node.outImages.size) {
                rows.push(
                    `<div class="edge-row"><span class="edge-label">images</span> ${[...node.outImages]
                        .map((t) => `<a href="${t}">${t}</a>`)
                        .join(', ')}</div>`
                );
            }
            if (node.broken.length) {
                rows.push(
                    `<div class="edge-row broken"><span class="edge-label">broken link</span> ${node.broken
                        .map((t) => `<span class="broken-target">${t}</span>`)
                        .join(', ')}</div>`
                );
            }
            const dateHtml = node.date ? ` <span class="node-date">${node.date}</span>` : '';
            return `<div class="node">
    <h2><a href="${file}">${node.title}</a>${dateHtml}</h2>
    ${rows.join('\n    ')}
</div>`;
        })
        .join('\n');

    const page = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>The Web</title>
    <style>
        body {
            font-family: 'Courier New', monospace;
            background-color: #0d1117;
            color: #c9d1d9;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px 20px 60px;
            line-height: 1.6;
        }
        h1 { color: #58a6ff; }
        .summary { color: #8b949e; margin-bottom: 30px; }
        .node { border-top: 1px solid #21262d; padding: 16px 0; }
        .node h2 { font-size: 1em; margin: 0 0 4px; }
        .node h2 a { color: #58a6ff; text-decoration: none; }
        .node h2 a:hover { text-decoration: underline; }
        .node-date { color: red; font-size: 0.85em; }
        .edge-row { font-size: 0.9em; color: #c9d1d9; margin-left: 20px; }
        .edge-label { color: #8b949e; display: inline-block; min-width: 110px; }
        .edge-row a { color: #56d364; text-decoration: none; }
        .edge-row a:hover { text-decoration: underline; }
        .broken .broken-target { color: #f85149; }
        a.back { color: #58a6ff; }
    </style>
</head>
<body>
    <h1>The Web</h1>
    <p class="summary">A map of how the poems and images link to one another &mdash; ${poemList.length} poems, ${totalLinks} internal links${totalBroken ? `, ${totalBroken} broken` : ''}.</p>
${entriesHtml}
</body>
</html>
`;

    await writeFile(path.join(REPO_ROOT, 'graph.html'), page, 'utf8');
    console.log(
        `Wrote graph.html: ${poemList.length} poems, ${totalLinks} internal links, ${totalBroken} broken links.`
    );
    if (totalBroken) {
        for (const [file, node] of sorted) {
            for (const b of node.broken) console.log(`  broken: ${file} -> "${b}"`);
        }
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

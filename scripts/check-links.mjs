#!/usr/bin/env node
// Sweeps the published site for links that do not resolve, and prints
// what it finds. Run with `npm run links`.
//
// The test suite runs the same sweep and fails on anything it finds;
// this is the version for a person, who wants the list rather than an
// assertion, and who may be running it before opening a pull request.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sweep } from './lib/sweep.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { pages, links, external, broken } = await sweep(REPO_ROOT);

console.log(
    `${pages.length} published pages | ${links} links between them | ` +
        `${external} pointing off the site | ${broken.length} broken`
);

for (const { from, href, why } of broken) {
    console.log(`  ${from}\n    -> ${JSON.stringify(href)}  (${why})`);
}

// Non-zero on a break, so it can stand in a hook or a shell one-liner
// without anyone having to read the output.
process.exit(broken.length ? 1 : 0);

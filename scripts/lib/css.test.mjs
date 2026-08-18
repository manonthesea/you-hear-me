// A light guard on assets/poem.css. Node can't render CSS, so this
// can't verify the visual result the way the browser measurements in
// the PRs did - it only catches an accidental revert of specific,
// deliberately-chosen values.

import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSS_PATH = path.join(__dirname, '..', '..', 'assets', 'poem.css');

// The stylesheet's own explanatory comments mention the exact property
// strings these tests check for (that's the point of the comments), so
// comments have to come out first or a comment satisfies the regex on
// its own without a real declaration existing at all.
function stripComments(css) {
    return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

test('body does not redeclare white-space: pre', async () => {
    // <pre> already has it natively. Body having it too made the raw
    // newlines between template tags (e.g. </h1> and <pre>) render as
    // visible blank space, inflating the title-to-verse gap well past
    // any margin actually set - see the h1 rule's own comment.
    const css = stripComments(await readFile(CSS_PATH, 'utf8'));
    const bodyRule = css.match(/\bbody\s*\{([^}]*)\}/s)?.[1] ?? '';

    assert.doesNotMatch(bodyRule, /white-space\s*:\s*pre/);
});

test('pre has an explicit margin, not the browser default', async () => {
    const css = stripComments(await readFile(CSS_PATH, 'utf8'));
    const preRule = css.match(/(?:^|\n)pre\s*\{([^}]*)\}/s)?.[1] ?? '';

    assert.match(preRule, /margin\s*:\s*0/);
});

test('the line-number color is the GitHub Dark numeric-literal orange', async () => {
    const css = stripComments(await readFile(CSS_PATH, 'utf8'));
    const rule = css.match(/\.line-number\s*\{([^}]*)\}/s)?.[1] ?? '';

    assert.match(rule, /color\s*:\s*#ffa657/i);
});

test('the title still lines up with the verse (unchanged from the alignment fix)', async () => {
    const css = stripComments(await readFile(CSS_PATH, 'utf8'));
    const h1Rule = css.match(/\bh1\s*\{([^}]*)\}/s)?.[1] ?? '';

    assert.match(h1Rule, /padding-left\s*:\s*calc\(40px \+ 30px \+ 0\.6rem\)/);
});

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
const TEMPLATE_PATH = path.join(__dirname, '..', '..', 'templates', 'poem-template.html');

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

test('footnotes share the left edge of the title and the verse', async () => {
    // The same offset h1 uses above. In px/rem, never em - .footnote
    // sets font-size: 0.85em, so an em offset would shrink with the type
    // and pull the citations left of everything else on the page.
    const css = stripComments(await readFile(CSS_PATH, 'utf8'));
    const rule = css.match(/\.footnote\s*\{([^}]*)\}/s)?.[1] ?? '';

    assert.match(rule, /padding-left\s*:\s*calc\(40px \+ 30px \+ 0\.6rem\)/);
});

test('footnotes fill the poem width without being what defines it', async () => {
    // width:0 + min-width:100% is load-bearing as a pair. Drop width:0
    // and a long citation becomes the widest thing in .poem, stretching
    // the page to its longest unbroken run; drop min-width and the
    // citation collapses instead of spanning the verse.
    const css = stripComments(await readFile(CSS_PATH, 'utf8'));
    const rule = css.match(/\.footnote\s*\{([^}]*)\}/s)?.[1] ?? '';

    assert.match(rule, /box-sizing\s*:\s*border-box/);
    assert.match(rule, /\bwidth\s*:\s*0/);
    assert.match(rule, /min-width\s*:\s*100%/);
});

test('the poem wrapper is sized by its longest line, with the body as a floor', async () => {
    const css = stripComments(await readFile(CSS_PATH, 'utf8'));
    const rule = css.match(/\.poem\s*\{([^}]*)\}/s)?.[1] ?? '';

    assert.match(rule, /width\s*:\s*max-content/);
    assert.match(rule, /min-width\s*:\s*100%/);
});

test('the template keeps the wrapper the footnote width depends on', async () => {
    // .poem is what <pre> and the citations are measured against; if the
    // template ever loses the div, the CSS above silently does nothing.
    // Matched loosely on purpose: the div carries a style attribute now,
    // and what this test is protecting is the wrapper, not its markup.
    const template = await readFile(TEMPLATE_PATH, 'utf8');

    assert.match(template, /<div class="poem"[^>]*>/);
});

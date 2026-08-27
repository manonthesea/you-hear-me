# Syncing poems from Google Docs

The website's poem pages can be regenerated from Google Docs, so editing a
poem is just editing a Doc — no HTML required. This doc covers one-time
setup and the ongoing authoring workflow.

## How it works

- Each poem lives as one Google Doc, anywhere in a Drive folder **tree**.
  The sync walks the whole tree from `DRIVE_FOLDER_ID` down, including
  every subfolder.
- **A poem is published only if its Doc's name ends with `(Publish)`** —
  e.g. a Doc named `6.20.4 (Publish)`. See below; this is the one gate
  that matters.
- Running the sync (`npm run sync`, or the "Sync poems" GitHub Action)
  exports each published Doc as HTML, converts it into the site's
  canonical template (`templates/poem-template.html` + `assets/poem.css`),
  and writes it to a path mirroring its Drive folder, named after the
  Doc — so a Doc called `Marsh Voices (Publish)` inside `Early Work`
  becomes `Early Work/Marsh Voices.html`.
- A page is only rewritten if its rendered content actually changed, so
  re-running the sync with no edits produces no diff.

## What gets published — read this one

**The repository is public.** Every file in it is served by GitHub Pages
and recorded in the git history permanently. A page that nothing links to
is still readable by anyone who guesses its URL, and deleting it later
does not remove it from the history.

So the sync will not write an unpublished poem into the repo at all.
Drafts are read and then discarded; only Docs marked `(Publish)` are
written.

- **To publish**: rename the Doc to end with `(Publish)`, e.g.
  `Marsh Voices (Publish)`. The rest of the name becomes the page's
  filename; the `<h1>` comes from the Doc's first line.
- **To unpublish**: remove `(Publish)` from the Doc's name. The next sync
  deletes the page.
- Case and inner spacing are flexible (`(publish)`, `(Published)`,
  `( Publish )` all work), but it must be that word in parentheses.
  A Doc merely *named* something like `Notes on Publishing` is not
  published.

Because publication state lives in the Doc's name, you can see at a
glance which poems in a folder are live without opening any of them.

## Removal

The sync records the pages it generated in `.poem-sync-manifest.json`.
On each run, any page in that manifest that the current run would no
longer produce — because the Doc was unpublished, renamed, moved, or
deleted — is removed from the repo.

Deletion is driven strictly by that manifest, so a page the sync never
created can never be deleted by it. The hand-made pages that predate the
sync are not in any manifest and are never touched. If a run has any
failures, cleanup is skipped entirely that time, so a transient Drive
error can't be mistaken for "the author unpublished everything."

A manifest that can't be parsed **fails the sync** rather than being read
as empty. An empty manifest is a legitimate state meaning "nothing has
been generated yet", so treating a corrupt file that way would make every
published page look like an orphan and delete the whole site in one
commit. Only a *missing* manifest counts as empty.

Each entry records the poem's Drive Doc ID alongside its path, so the
sync knows not just where a poem was published but which poem it is —
identity that survives every rename, retitle and move.

## The link ledger

Cross-poem links live in `links.yml` at the repo root, not inside the
Docs. Two sections: what the poems are called, and what links to what.

```yaml
poems:
  snafu:         { doc: 1BxiMVs0XRA5nFMdKvBd..., title: SNAFU }
  march-25-1945: { doc: 1Cy7dK2mPqR8vN4xTgHj..., title: "March 25th, 1945" }

links:
  - { from: snafu,  phrase: repetitive repetition, to: march-25-1945 }
  - { from: snafu,  phrase: "Fussel, Paul.", href: "https://en.wikipedia.org/wiki/Paul_Fussell" }
  - { from: osiris, phrase: Black mud sound, asset: scan0005.jpg }
```

A link has exactly one destination: `to` a poem, `href` an external URL,
or `asset` a file in the repo. Poem and asset paths are stored
root-relative and made relative to each page at build time, because pages
sit at different depths.

Run `npm run poems:ids` to print the `poems:` block ready to paste — it
reads the manifest and the published pages, so it needs no Drive
credentials. It lists poems only; the plates in the manifest are pages
but not poems, and offering them as such once produced a block that
could not safely be pasted.

The slug is yours to rename — it only has to be unique, and the `title`
beside it is a comment for the reader. What must not change is the Doc
the slug is bound to. Rename it in the `poems:` block and in every
`from`/`to` that names it; a slug nothing resolves to is reported as
waiting rather than applied.

### Anchors

The `phrase` is found in the poem's rendered text — the verse *and* its
footnotes, since a citation is as linkable as a line.

- **Whole words.** `her` does not match inside `whether`.
- **Exact case.** `rains` does not match `Rains too long in coming`.
- **Curly quotes fold.** `men's` in the ledger finds `men’s` in the poem.
- Everything else is literal. No patterns, no fuzzy fallback: a near miss
  fails and says so.

A phrase must occur **exactly once** in the poem. If it occurs twice,
lengthen it until it's unique — never number the occurrence, because a
number keeps working while silently pointing somewhere new after an edit.

An anchor may span several elements (a quoted stanza is one italic run
per line). The link is reopened around each fragment rather than wrapped
across a tag boundary, which renders as one continuous link.

### When something doesn't fit

Two failures, treated differently on purpose:

- **A mistake in the file** — unknown slug, no destination, two slugs
  bound to one Doc — stops the run before anything is written. It's a
  typo in a version-controlled file, and the error names the entry.
- **A poem that isn't published yet** is a normal state. The link waits,
  the words stay, and the run reports it. That's what lets the whole
  ledger be written before every poem exists.

An anchor that no longer matches, or an asset that's missing, does **not**
block publishing: the poem's words are still correct and only a link is
absent. Pages are written and the run then exits non-zero, so the failure
arrives as a red build rather than as a reader's dead link months later.

## Permanent links

A poem's readable path comes from its Doc's name, so it changes whenever
the Doc is renamed or moved. That has happened more than twenty times,
and each time it silently broke every link anyone had shared.

Every published poem therefore also gets a permanent URL at
`p/<id>/`, where `<id>` is derived from the Drive Doc ID. It redirects to
wherever the poem currently lives, and the sync rewrites it whenever that
changes. The readable path stays canonical — this is an addition, not a
replacement.

- The identifier is a **hash** of the Doc ID, not the ID itself. The repo
  is public and Drive identifiers don't belong on public pages. Hashing
  also keeps it a pure function of the Doc, so there's no registry file
  to maintain and the same poem always gets the same URL.
- **The identifier is a published URL.** Changing how it's derived breaks
  every link already shared, so it's pinned by a test with a literal
  expected value. If that test fails, the fix is to restore the old
  derivation, not to update the expected value.
- Two poems resolving to one identifier fails the sync rather than
  letting write order decide which becomes unreachable.
- Unpublished poems get no permalink, the same as they get no page.
- A permalink whose poem is unpublished is cleaned up by the same
  manifest rule that removes the page itself.

## One-time setup

The sync authenticates to Google via **Workload Identity Federation
(WIF)** rather than a downloaded service account key — GitHub Actions
exchanges a short-lived OIDC token for Google credentials at run time, so
no long-lived secret ever exists to leak or rotate. This also sidesteps
any org policy that blocks service account key creation (a policy Google
now enforces by default on many projects).

### 1. Create a Google Cloud project and service account

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
   and create a new project (or reuse one). The examples below use
   `YOUR_PROJECT_ID` — substitute your actual project ID throughout.
2. Enable the **Google Drive API**: APIs & Services → Enable APIs and
   Services → search "Google Drive API" → Enable.
3. Create the service account: **APIs & Services → Credentials → Create
   Credentials → Service account**. Name it `poem-sync`. No project
   roles are needed — access is granted by sharing the Drive folder
   directly (step 2 below). Note its email:
   `poem-sync@YOUR_PROJECT_ID.iam.gserviceaccount.com`.

No key is created for it — WIF lets GitHub Actions impersonate this
service account directly.

### 2. Share the Drive folder

1. Create (or pick) a Google Drive folder that will hold one Doc per
   poem.
2. Share that folder with the service account's email address, with
   **Viewer** access (read-only is all the sync needs).
3. Open the folder in a browser and copy its ID out of the URL:
   `https://drive.google.com/drive/folders/`**`THIS_PART_IS_THE_ID`**

### 3. Set up Workload Identity Federation

Run these with the [gcloud CLI](https://cloud.google.com/sdk/docs/install)
(Cloud Shell, in the console, works too — no local install needed).
Replace `YOUR_PROJECT_ID` and `manonthesea/you-hear-me` as needed.

```bash
gcloud config set project YOUR_PROJECT_ID

# Create a pool to hold external (GitHub) identities
gcloud iam workload-identity-pools create "github-pool" \
  --location="global" \
  --display-name="GitHub Actions Pool"

# Create a provider that trusts GitHub's OIDC issuer, restricted to
# this one repo so no other repo can use these credentials
gcloud iam workload-identity-pools providers create-oidc "github-provider" \
  --location="global" \
  --workload-identity-pool="github-pool" \
  --display-name="GitHub provider" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository=='manonthesea/you-hear-me'" \
  --issuer-uri="https://token.actions.githubusercontent.com"

# Get your project number (needed for the next command)
gcloud projects describe YOUR_PROJECT_ID --format="value(projectNumber)"

# Let that pool (scoped to this repo) impersonate the poem-sync service account
gcloud iam service-accounts add-iam-policy-binding \
  "poem-sync@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/YOUR_PROJECT_NUMBER/locations/global/workloadIdentityPools/github-pool/attribute.repository/manonthesea/you-hear-me"
```

The full provider resource name you'll need next is:

```
projects/YOUR_PROJECT_NUMBER/locations/global/workloadIdentityPools/github-pool/providers/github-provider
```

### 4. Add GitHub repository secrets

In the repo's **Settings → Secrets and variables → Actions**, add:

- `GCP_WORKLOAD_IDENTITY_PROVIDER` — the provider resource name from
  step 3.
- `GCP_SERVICE_ACCOUNT_EMAIL` — `poem-sync@YOUR_PROJECT_ID.iam.gserviceaccount.com`.
- `DRIVE_FOLDER_ID` — the folder ID from step 2.

### 5. Populate the folder tree

Organize poems into whatever folder structure you like under the shared
folder — the sync walks all of it. Keep naming Docs however you already
do (by date, here), and append `(Publish)` to the ones that should be
live on the site:

```
GitHub Sync/                    <- DRIVE_FOLDER_ID
  Marsh Voices (Publish)        -> Marsh Voices.html
  Early Work/
    Pagus Trip (Publish)        -> Early Work/Pagus Trip.html
    Half-finished thing         -> not published, not written
```

The Doc's name gives the page its filename and URL. The poem's title —
the `<h1>` — is the Doc's first line, which may be plain text or a
Heading. Nothing inside the poem can change its URL.

## The page template

`templates/poem-template.html` is the shape every generated page takes.
It contains the placeholders that `scripts/sync-poems.mjs` fills in:

- `{{TITLE}}` — the poem title, taken from the Doc's first line (the
  filename comes from the Doc's *name*, not this)
- `{{CSS_PATH}}` — the path back to `assets/poem.css`, which depends on
  how deep in the folder tree the page sits
- `{{BODY}}` — the poem body: numbered `<pre>` lines, stanza markers,
  ellipsis/italic/indent spans, cross-poem links
- `{{DATE}}` — the poem's date line, empty if the last line isn't
  date-shaped
- `{{FOOTNOTES}}` — any footnote citations, rendered as
  `<p class="footnote">` blocks; empty if the poem has none

Keep those placeholder strings out of any comment or literal text in the
template — every occurrence is substituted, so a stray mention in a
comment would swallow the real content.

## Authoring conventions inside each Doc

- **Filename**: the page's path comes from the **Doc's name** (minus the
  `(Publish)` annotation). A Doc called `Pagus Trip (Publish)` publishes
  to `Pagus Trip.html`. Nothing inside the poem can change its URL.
- **Title**: the **first line of the Doc** is the poem's title, and sets
  the `<h1>` and the browser title. It is not repeated in the body. The
  title may be plain text or styled *Heading 2 / Heading 3* — both are
  recognised.
  - If the first line is implausibly long (over 80 characters) it is
    assumed to be verse rather than a title, and the Doc's name is used
    for the `<h1>` instead. Each sync logs the title it chose for every
    poem, so check the run log after a first sync.
- **Line breaks**: soft line breaks (Shift+Enter) and separate paragraphs
  are both honoured — each becomes its own numbered line. A stanza
  written as one paragraph of soft-broken lines comes through intact.
- **Stanza / section markers**: a line that is only a number and a period
  (`1.`, `2.`) is detected automatically and styled green and indented
  (`.stanza`). It is still a numbered line of the poem like any other —
  only the styling sets it apart.
- **Date**: the **last non-blank line** in the Doc is treated as the
  date, but only if it's shaped like one — `n.n.nn` / `nn.nn.nn`
  (`6.20.4`, `12.31.19`) or a line starting with `Circa`
  (case-insensitive). `Circa` doesn't have to name a year: `Circa
  College` and `Circa Before Time` are dates the same way `Circa 2010`
  is. A last line that doesn't match either shape is left as an ordinary
  line of verse, and the date is simply empty — it is never guessed at
  or swallowed.
- **Other stanza markers**: apply the *Heading 2* paragraph style in
  Google Docs to any line that should get the same green treatment but
  isn't a bare `1.`-style marker.
- **Line numbering**: every line of the poem is numbered — blank lines
  and stanza markers included. The page is meant to read like a poem
  open in a code editor, where every line carries a number.
- **Blank lines**: a run of consecutive blank lines (a page break in a
  Doc exports as dozens of empty paragraphs) collapses to a single
  numbered blank line.
- **Italics**: use Google Docs' italic formatting as normal — a run
  within a line, or a whole line at once. Both are recognized; Google
  exports a fully-italic line differently (the styling sits on the line
  itself rather than a run inside it), and both shapes are handled.
  Because the export can express italics several ways and there is no
  way to pin down which one a given Doc will use, the sync accepts all
  of them — stylesheet classes (including grouped selectors and a
  second `<style>` block), inline `style` attributes, and `<i>`/`<em>`
  tags. If a poem ever comes back without its italics, that list is the
  place to add a shape.
- **Superscripts**: a number formatted as superscript becomes a footnote
  marker (`.footnote-number`), the same one Docs' own footnotes get, so
  a citation numbered by hand looks like a native one. A superscript
  that isn't a bare number — the `st` in `1st` — stays an ordinary
  superscript.
- **Indentation**: use Google Docs' "Increase indent" — one level maps
  to a small indent, two levels to a larger one. This is a best-effort
  conversion; spot-check indentation after a poem's first sync.
- **Ellipses**: type `...` or `. . .` — it's automatically rendered in
  the site's green ellipsis style.
- **Cross-poem and image links**: select text and use Google Docs'
  "Insert link" as normal.
  - Link to **another poem** by pasting that Doc's share link — the sync
    rewrites it to the right relative path, across folders included (a
    link from `Early Work/A.html` to a root-level poem becomes
    `../Marsh Voices.html`).
  - Because links are stored as **Doc IDs**, not filenames, they survive
    retitling and moving: rename a poem and every link to it is
    regenerated correctly on the next sync. (The hand-made pages use
    literal filenames, which is why several of them ended up pointing at
    a page that no longer existed.)
  - A link to an **unpublished** Doc has no page to point at. The words
    are kept and the link is dropped — the `docs.google.com` URL is
    never written to the public page. The sync log notes each one, so
    the run log tells you which links are still waiting on a poem to be
    published.
  - Link to an **image already committed to the repo** (e.g.
    `scan0005.jpg`) by pasting its filename or full GitHub Pages URL.
  - External links (articles, photos, maps) work as-is.
- **Footnotes**: use Google Docs' native "Insert footnote" as normal.
  The in-text marker becomes a numbered superscript
  (`.footnote-number`), and the citation itself is rendered as a
  `<p class="footnote">` after the poem — the same convention the
  hand-made pages already use. Links and italics inside a footnote's
  text are preserved.
  - A footnote may run to **several paragraphs** — press Enter inside
    the footnote as normal. A citation followed by the passage it
    quotes is the usual case, and the whole thing lands in one
    `<p class="footnote">`. (Only the first paragraph used to be read,
    so every such citation published truncated at its line break, with
    the quotation silently dropped.)
  - This is a best-effort match to Google's export shape, the same
    caveat as indentation above — spot-check a footnoted poem's first
    sync.
  - If a citation's text doesn't come through (an export shape this
    doesn't recognize), the numbered marker still appears in the poem,
    but the sync log for that run notes exactly which footnote number
    is missing its text, rather than silently publishing a marker that
    points at nothing.

## Running a sync

- **Automatically on merge**: any push to `main` (a merged PR, say) runs
  the sync. The sync's own commit is pushed with `GITHUB_TOKEN`, and
  GitHub does not re-trigger workflows from those pushes, so it cannot
  loop.
- **From GitHub**: Actions tab → "Sync poems" workflow → Run workflow.
  It exports every Doc, regenerates changed pages, rebuilds the
  Commonplace Book (`commonplace.html`), and pushes a commit only if
  something changed. This stays the way to publish a **Doc edit**: nothing on
  GitHub can detect that you edited a poem in Drive, so a manual run (or
  a scheduled one, if ever added) is the only thing that picks it up.
- **Locally**: `npm install`, run `gcloud auth application-default
  login --impersonate-service-account=poem-sync@YOUR_PROJECT_ID.iam.gserviceaccount.com`
  once (this needs `roles/iam.serviceAccountTokenCreator` on the
  service account for your own user, granted separately if you want
  local runs), set `DRIVE_FOLDER_ID` in your shell, and run
  `npm run sync`.

## Branch protection and the sync's push

If `main` is protected with a required status check, that protection
applies to **direct pushes too**, not just pull requests — and the
sync pushes its commit straight to `main`. A freshly pushed commit has
no checks on it yet, so the push is rejected and the sync fails at its
last step.

To run both, the rule needs a bypass for the workflow's identity. Use a
**ruleset** (Settings → Rules → Rulesets) rather than classic branch
protection, since only rulesets support bypass actors:

1. New branch ruleset, targeting `main`.
2. Enable **Require status checks to pass** → add `test`.
3. Under **Bypass list**, add the **GitHub Actions** app.

That leaves pull requests gated on the tests while the sync can still
publish. If the bypass isn't available, the alternative is to push with
a personal access token instead of `GITHUB_TOKEN` — but note that a PAT
push *does* re-trigger workflows, so the `push: main` trigger would then
have to be removed to avoid a loop.

## Tests

`npm test` runs the tests (`scripts/lib/*.test.mjs`, built on Node's own
test runner — no extra dependencies). `publish.test.mjs` covers the
publish gate, the folder-to-path mapping, collisions, and which pages
deletion may select; `convert.test.mjs` covers the
Doc → page conversion rules (line numbering, date extraction, stanza
headings, indent levels, italics, ellipses, link rewriting, escaping)
and assert that a rendered page has no template placeholders left in it.
They also run in CI on every push and pull request.

They do *not* verify that real Google Docs exports match the fixtures
they're built on, so still eyeball a poem's first sync.

## Known limitations

- Footnote conversion is a best-effort match to Google's export shape
  (see above) — spot-check a footnoted poem's first sync.
- Indentation level detection is heuristic, not exact.
- Images aren't pulled from Drive — they're expected to already exist in
  the repo (or be linked externally) and referenced by filename/URL from
  the Doc.

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
  and writes it to a path mirroring its Drive folder — so a published Doc
  inside `Early Work` whose first line is `Marsh Voices` becomes
  `Early Work/Marsh Voices.html`.
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
  `6.20.4 (Publish)`. The rest of the name is not used for the page —
  the title comes from the Doc's first line.
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
GitHub Sync/                 <- DRIVE_FOLDER_ID
  6.20.4 (Publish)           -> Marsh Voices.html      (title from line 1)
  Early Work/
    12.11.18 (Publish)       -> Early Work/Winter.html (title from line 1)
    3.4.19                   -> not published, not written
```

The Doc name carries the date and the `(Publish)` flag; the poem's title
comes from its first line.

## The page template

`templates/poem-template.html` is the shape every generated page takes.
It contains the placeholders that `scripts/sync-poems.mjs` fills in:

- `{{TITLE}}` — the poem title, taken from the Doc's first line
- `{{CSS_PATH}}` — the path back to `assets/poem.css`, which depends on
  how deep in the folder tree the page sits
- `{{BODY}}` — the poem body: numbered `<pre>` lines, stanza markers,
  ellipsis/italic/indent spans, cross-poem links
- `{{DATE}}` — the poem's date line

Keep those placeholder strings out of any comment or literal text in the
template — every occurrence is substituted, so a stray mention in a
comment would swallow the real content.

## Authoring conventions inside each Doc

- **Title**: the **first line of the Doc** is the poem's title. It sets
  the `<h1>`, the browser title, and the output filename, and it is not
  repeated in the poem body. The Doc's *name* is only used for the
  `(Publish)` annotation — these Docs are named by date, so the name is
  not the title.
  - If the first line is implausibly long (over 80 characters) it is
    assumed to be verse rather than a title, and the Doc's name is used
    instead. Each sync logs the title it chose for every poem, so check
    the run log after a first sync.
- **Stanza / section markers**: a line that is only a number and a period
  (`1.`, `2.`) is detected automatically and styled green and indented
  (`.stanza`). It is still a numbered line of the poem like any other —
  only the styling sets it apart.
- **Date**: the **last non-blank line** in the Doc is treated as the
  date (e.g. `6.20.4`, `Circa 2010`).
- **Other stanza markers**: apply the *Heading 2* paragraph style in
  Google Docs to any line that should get the same green treatment but
  isn't a bare `1.`-style marker.
- **Line numbering**: every line of the poem is numbered — blank lines
  and stanza markers included. The page is meant to read like a poem
  open in a code editor, where every line carries a number.
- **Blank lines**: a run of consecutive blank lines (a page break in a
  Doc exports as dozens of empty paragraphs) collapses to a single
  numbered blank line.
- **Italics**: use Google Docs' italic formatting as normal.
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
    `../Marsh Voices.html`). Links to *unpublished* Docs are left as
    Google Docs links, since there is no page to point at.
  - Link to an **image already committed to the repo** (e.g.
    `scan0005.jpg`) by pasting its filename or full GitHub Pages URL.
  - External links (articles, photos, maps) work as-is.
- **Footnotes**: native Google Docs footnotes are not converted yet.
  Poems that need footnotes (like `SNAFU.html`) should stay
  hand-maintained outside the synced folder for now.

## Running a sync

- **Automatically on merge**: any push to `main` (a merged PR, say) runs
  the sync. The sync's own commit is pushed with `GITHUB_TOKEN`, and
  GitHub does not re-trigger workflows from those pushes, so it cannot
  loop.
- **From GitHub**: Actions tab → "Sync poems" workflow → Run workflow.
  It exports every Doc, regenerates changed pages, rebuilds the
  narrative map (`graph.html`), and pushes a commit only if something
  changed. This stays the way to publish a **Doc edit**: nothing on
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

- Native Google Docs footnotes aren't converted (see above).
- Indentation level detection is heuristic, not exact.
- Images aren't pulled from Drive — they're expected to already exist in
  the repo (or be linked externally) and referenced by filename/URL from
  the Doc.

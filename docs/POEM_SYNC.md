# Syncing poems from Google Docs

The website's poem pages can be regenerated from Google Docs, so editing a
poem is just editing a Doc — no HTML required. This doc covers one-time
setup and the ongoing authoring workflow.

## How it works

- Each poem lives as one Google Doc in a shared Drive folder.
- Running the sync (`npm run sync`, or the "Sync poems" GitHub Action)
  exports every Doc in that folder as HTML, converts it into the site's
  canonical template (`templates/poem-template.html` +
  `assets/poem.css`), and writes/updates the matching `<Title>.html` file
  at the repo root.
- A page is only rewritten if its rendered content actually changed, so
  re-running the sync with no edits produces no diff.
- The sync is manual (`workflow_dispatch` in GitHub Actions) — nothing
  publishes automatically when you edit a Doc. Run it when you want the
  site to catch up.

## One-time setup

### 1. Create a Google Cloud project and service account

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
   and create a new project (or reuse one).
2. Enable the **Google Drive API** for that project (APIs & Services →
   Enable APIs and Services → search "Google Drive API" → Enable).
3. Go to **APIs & Services → Credentials → Create Credentials → Service
   account**. Give it any name, e.g. `poem-sync`. No project roles are
   needed — access is granted by sharing the Drive folder directly.
4. Open the new service account → **Keys** tab → **Add Key → Create new
   key → JSON**. This downloads a JSON key file — keep it private, it's
   a credential.
5. Note the service account's email address (looks like
   `poem-sync@your-project.iam.gserviceaccount.com`).

### 2. Share the Drive folder

1. Create (or pick) a Google Drive folder that will hold one Doc per
   poem.
2. Share that folder with the service account's email address, with
   **Viewer** access (read-only is all the sync needs).
3. Open the folder in a browser and copy its ID out of the URL:
   `https://drive.google.com/drive/folders/`**`THIS_PART_IS_THE_ID`**

### 3. Add GitHub repository secrets

In the repo's **Settings → Secrets and variables → Actions**, add:

- `GOOGLE_SERVICE_ACCOUNT_KEY` — paste the *entire contents* of the JSON
  key file downloaded in step 1.
- `DRIVE_FOLDER_ID` — the folder ID from step 2.

### 4. Populate the folder

Create one Google Doc per poem in the folder, named exactly as you want
the poem's title to appear (the Doc's file name becomes both the page
title and the output filename, e.g. a Doc named `Marsh Voices` produces
`Marsh Voices.html`).

## Authoring conventions inside each Doc

- **Title**: the Doc's file name *is* the title. You may optionally
  repeat it as the first line of the Doc — the sync detects and skips a
  redundant first line matching the title.
- **Date**: the **last non-blank line** in the Doc is treated as the
  date (e.g. `6.20.4`, `Circa 2010`).
- **Stanza headings**: apply the *Heading 2* paragraph style in Google
  Docs to a line to make it a stanza heading.
- **Italics**: use Google Docs' italic formatting as normal.
- **Indentation**: use Google Docs' "Increase indent" — one level maps
  to a small indent, two levels to a larger one. This is a best-effort
  conversion; spot-check indentation after a poem's first sync.
- **Ellipses**: type `...` or `. . .` — it's automatically rendered in
  the site's green ellipsis style.
- **Cross-poem and image links**: select text and use Google Docs'
  "Insert link" as normal.
  - Link to **another poem** in the same folder by pasting that Doc's
    share link — the sync rewrites it to the correct local
    `<Title>.html` link automatically.
  - Link to an **image already committed to the repo** (e.g.
    `scan0005.jpg`) by pasting its filename or full GitHub Pages URL.
  - External links (articles, photos, maps) work as-is.
- **Footnotes**: native Google Docs footnotes are not converted yet.
  Poems that need footnotes (like `SNAFU.html`) should stay
  hand-maintained outside the synced folder for now.

## Running a sync

- **From GitHub**: Actions tab → "Sync poems" workflow → Run workflow.
  It exports every Doc, regenerates changed pages, rebuilds the
  narrative map (`graph.html`), and pushes a commit only if something
  changed.
- **Locally**: `npm install`, then set `GOOGLE_SERVICE_ACCOUNT_KEY` (the
  JSON key contents) and `DRIVE_FOLDER_ID` in your shell, and run
  `npm run sync`.

## Known limitations

- Native Google Docs footnotes aren't converted (see above).
- Indentation level detection is heuristic, not exact.
- Images aren't pulled from Drive — they're expected to already exist in
  the repo (or be linked externally) and referenced by filename/URL from
  the Doc.

# The trail endpoint

The poems report here when a reader crosses a link. `trail.js` is the
whole of it: it takes a crossing, writes one row, and says nothing else.

What a row holds is an edge and a moment — which page, which words,
where they led. No identifier, no session, no cookie, no address. Two
readers crossing the same link are indistinguishable in the store, which
is the point: this is meant to say which paths through the poems get
walked, not who walked them.

## How it deploys

Through this repository. A merge to `main` that touches this directory
builds and deploys it, the way a merge already publishes everything
else. Nothing is pasted into a browser editor.

The Worker is `you-hear-me-trail`, connected under **Settings → Build**
in the Cloudflare dashboard, with:

| field | value | why |
| --- | --- | --- |
| Deploy command | `npx wrangler deploy --config worker/wrangler.toml` | the build runs at the repository root, where there is no config; this points at the one in here |
| Path | `/` | the repository root, which is where the command above expects to be |
| Build command | *(empty)* | there is nothing to build |
| Preview builds | off | otherwise every branch pushed here rebuilds the Worker |

`main = "trail.js"` in the config resolves relative to the config file,
so it finds the file beside it without any path of its own.

### Still to do

**Build watch paths** are not set. The field was not offered when the
repository was connected. Until it is set to `worker/*`, every sync of
the poems - which commits to `main` on its own schedule - rebuilds a
Worker that has not changed. Wasteful rather than wrong.

## The store

One KV namespace, `TRAIL`, bound as `env.TRAIL`. Its id is in
`wrangler.toml` and is an identifier rather than a secret: it names
which store the binding points at and carries no authority over it, so
knowing it lets nobody read or write the store.

Keys are `e:<time>:<random>`, with the time zero-padded to a fixed
width so that listing the keys in order lists the crossings in the order
they happened. Rows expire after a year.

One row per crossing rather than a counter per edge, because KV has no
atomic increment and settles eventually: counting would quietly lose
writes whenever two readers moved at once. An append-only row cannot
race with itself, and the counting is done later, by whoever reads.

## Checking it

`trail.test.mjs` runs as part of `npm test`. It calls the Worker
directly with a stand-in for the KV binding - the Worker is plain module
code over the standard `Request` and `Response`, so no Cloudflare is
needed to exercise it.

Against the deployed one, the dashboard's own HTTP tester is the
quickest way:

- a **GET** should answer `{"ok":true}`. That is all it is for -
  something to point a browser at to see whether a deploy took.
- a **POST** of `{"from":"/a.html","to":"/b.html","phrase":"semblance"}`
  should answer `204`, print `/a.html -> /b.html ("semblance")` in the
  console, and leave a row in `TRAIL`.

The log line is said before the write rather than after, so a crossing
that arrives but fails to store still shows up. A line with no `204`
after it is a write that did not land.

## When it goes wrong

| what you see | what it means |
| --- | --- |
| no request at all | the beacon never fired: the script is missing from the page, or the reader asked not to be followed |
| `403` | the origin is not in `ALLOWED_ORIGINS` |
| `400` | the body was not a crossing, or was over 1024 bytes and stopped being JSON |
| `204` but no row | the binding is not the `TRAIL` the code reads |

The reporting half lives in `assets/trail.js` and rides on every poem
and every plate.

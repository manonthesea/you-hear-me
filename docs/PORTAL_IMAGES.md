# Portal images

A portal is a poem that ends a path in the Maze but links back into it, so the
path is not dead. Its link travels **through a picture** — see the *Portals*
section of `POEM_SYNC.md` for the `via:` grammar.

There are 24 of them. Each needs its own image; an image may not lead two ways.
This is how the brief for one gets written.

## The method

The brief is written **for the image model, not for a person**. Ceiling of 250
words. No connective tissue that exists only to be readable — the receiving
model does not need "read this as", it needs conditioning.

1. **Read both poems in full, and enough of the corpus to know its laws.** The
   laws are the point: they are what the two poems on their own cannot tell you.
   In this collection `water ≡ time`, so a *dry* riverbed is time refusing to
   give — unreadable from the one poem, decisive for the picture.
2. **Find the hinge.** The shared word, taken seriously. Etymology counts:
   `polis` is the counted city, `pagus` the stake driven outside it, the root of
   *pagan*. Check for citation — *By the Numbers* opens with **Numbers 1:1**
   verbatim, and Numbers 1:2 is a census of men able to go to war.
3. **Find the one image the two poems share from different vantages.** Both
   poems here hold a column of walking bodies: one inside the count, one
   watching from the far bank. That doubling is the portal.
4. **State the terminal condition.** If the poem does not resolve, forbid
   resolution in as many words. Most of these poems do not resolve.
5. **Disclose the transaction.** This corpus addresses its own parser and
   predicts we will fail it — `//so they comment it out`, a code comment set
   inside a poem; *significance the parsing machines will never catch*. Say so.
   The instruction that follows is: **render the not-landing, not the meaning.**
6. **Emit as `+` / `-` token lines**, then the palette. Note that weighting
   syntax differs by host and should be transposed.

## House constraints

The plates this hangs beside are found photographs with provenance — Patton's
men on the Rhine, a kamikaze run with chrysanthemums painted in. Documentary,
not illustration. Mid-century press stock, silver grain, colour lying wrong on
grey the way hand-tinting does.

Forbid: flags, insignia, any nameable nation or decade, allegory made explicit,
symmetry, resolution, anything clean.

## On forbidding glyphs

The brief says no legible text. The first portal came back with **"you hear me"**
faint along the horizon — the collection's own title, and the question nearly
every poem ends on. It is the one glyph that belongs, so the rule stands as
written and this stays the exception rather than becoming a licence.

## Wiring one up

Put the image in the repo root beside the other plates, then one line:

```yaml
  - { from: by-the-numbers, phrase: "polis", to: pagus-trip, via: "polis.jpg" }
```

Anything about the picture itself — title, `zoom`, `focus` — goes in `assets:`.
Where it leads does not: that belongs to the link.

Then `npm run commonplace && npm run paths && npm run maze`, and check the
thread appears in all three. If it appears in none, the link was written as an
`asset:` and the thread is gone.

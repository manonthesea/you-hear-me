// The link ledger: every cross-poem link in the collection, kept in the
// repo rather than pasted into the Docs.
//
// Poems are named by a slug the poet chooses once, bound to the Drive
// Doc ID. Nothing else is stable enough to key on - paths have churned
// more than twenty times, and titles change too ("Birth of Tragedy"
// became "The Birth of Tragedy", "The Bard Speaks" became "The Bard
// Sings"). The slug is what gets typed; the Doc ID does the surviving.
//
// Two failure modes are treated very differently, on purpose:
//
//   A mistake in the ledger - an unknown slug, a link with no
//   destination, a duplicate binding - is a typo in a file under
//   version control. It fails immediately and names the line.
//
//   A poem that is not published yet is a normal state, not a mistake.
//   The link is dropped, the words are kept, and the run reports it -
//   exactly what the sync already does for a Drive link pointing at an
//   unpublished Doc. That is what lets the whole ledger be written
//   before every poem exists.

import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { escapeHtml } from './render.mjs';

// Where a click-magnified view sits across the picture, as a fraction of
// its width. Both spellings of the middle, because both get typed.
const FOCUS_WORDS = { left: 0, center: 0.5, centre: 0.5, right: 1 };

/**
 * @param {string} text - contents of links.yml.
 * @returns {{ poems: Map<string, {doc: string, title: string|null}>, links: Array<object> }}
 * @throws on anything malformed; a ledger that half-parses would silently drop links.
 */
export function parseLedger(text) {
    let doc;
    try {
        doc = parseYaml(text);
    } catch (err) {
        throw new Error(`links.yml is not valid YAML: ${err.message}`);
    }
    if (doc === null || doc === undefined) return { poems: new Map(), links: [] };
    if (typeof doc !== 'object' || Array.isArray(doc)) {
        throw new Error('links.yml must be a mapping with "poems" and "links".');
    }

    const poems = new Map();
    const seenDocs = new Map();
    for (const [slug, value] of Object.entries(doc.poems ?? {})) {
        if (!value || typeof value !== 'object' || typeof value.doc !== 'string' || !value.doc) {
            throw new Error(`poems.${slug} needs a "doc" (the Drive Doc ID).`);
        }
        if (poems.has(slug)) throw new Error(`poems.${slug} is defined twice.`);
        const clash = seenDocs.get(value.doc);
        if (clash) {
            throw new Error(`poems.${slug} and poems.${clash} are bound to the same Doc.`);
        }
        seenDocs.set(value.doc, slug);
        poems.set(slug, { doc: value.doc, title: value.title ?? null });
    }

    // Optional per-image configuration. Every image linked from a poem
    // gets a plate whether or not it appears here; this section only
    // says how a particular one should differ from the default.
    const assets = new Map();
    for (const [asset, value] of Object.entries(doc.assets ?? {})) {
        if (!value || typeof value !== 'object') {
            throw new Error(`assets["${asset}"] must be a mapping.`);
        }
        const { title, overlay, zoom, scroll, to, href } = value;
        const zoomOn = value['zoom-on'];
        const focus = value.focus;
        if (zoom !== undefined && (typeof zoom !== 'number' || !(zoom > 0))) {
            throw new Error(`assets["${asset}"].zoom must be a positive number (1 is fit-to-screen).`);
        }
        if (scroll !== undefined && (typeof scroll !== 'number' || scroll < 0 || scroll > 1)) {
            throw new Error(`assets["${asset}"].scroll must be between 0 and 1.`);
        }
        // When the magnification happens: from the outset, or on the
        // reader's first click, the click after that following the link.
        if (zoomOn !== undefined) {
            if (zoomOn !== 'load' && zoomOn !== 'click') {
                throw new Error(`assets["${asset}"]["zoom-on"] must be "load" or "click".`);
            }
            if (zoom === undefined) {
                throw new Error(`assets["${asset}"]["zoom-on"] needs a "zoom" to act on.`);
            }
        }
        // Where to open the view only means something for a plate that
        // is already magnified when it opens. Click-to-zoom decides that
        // from where the reader clicked, so the two cannot both apply.
        if (zoomOn === 'click' && scroll !== undefined) {
            throw new Error(`assets["${asset}"].scroll applies to "zoom-on: load"; with "click" the reader's own click places the view.`);
        }
        // Which part of the width a click-magnified view frames. Named
        // for the poet's sake - "left" reads better in this file than "0"
        // - but a fraction is accepted for anything in between.
        let focusAcross = null;
        if (focus !== undefined) {
            if (zoomOn !== 'click') {
                throw new Error(`assets["${asset}"].focus applies to "zoom-on: click"; a plate that opens magnified is placed by "scroll".`);
            }
            focusAcross = FOCUS_WORDS[focus] ?? focus;
            if (typeof focusAcross !== 'number' || !(focusAcross >= 0 && focusAcross <= 1)) {
                throw new Error(`assets["${asset}"].focus must be left, center, right, or a fraction between 0 and 1.`);
            }
        }
        // Where clicking the image leads. Left unset, a plate returns the
        // reader to the poem they came from; setting it pins a
        // destination instead.
        const clicks = [to, href].filter((t) => t !== undefined);
        if (clicks.length > 1) {
            throw new Error(`assets["${asset}"] needs at most one of "to" or "href".`);
        }
        if (to !== undefined && !poems.has(to)) {
            throw new Error(`assets["${asset}"].to names an unknown poem: "${to}".`);
        }
        if (overlay !== undefined) {
            if (!overlay || typeof overlay !== 'object') {
                throw new Error(`assets["${asset}"].overlay must be a mapping.`);
            }
            if (typeof overlay.image !== 'string' || !overlay.image) {
                throw new Error(`assets["${asset}"].overlay needs an "image".`);
            }
            for (const key of ['width', 'right']) {
                if (overlay[key] !== undefined && typeof overlay[key] !== 'number') {
                    throw new Error(`assets["${asset}"].overlay.${key} must be a number (percent of the image's width).`);
                }
            }
            const targets = [overlay.to, overlay.href].filter((t) => t !== undefined);
            if (targets.length !== 1) {
                throw new Error(`assets["${asset}"].overlay needs exactly one of "to" or "href".`);
            }
            if (overlay.to !== undefined && !poems.has(overlay.to)) {
                throw new Error(`assets["${asset}"].overlay.to names an unknown poem: "${overlay.to}".`);
            }
        }
        assets.set(asset, {
            title: title ?? null,
            zoom: zoom ?? null,
            zoomOn: zoomOn ?? 'load',
            focus: focusAcross,
            scroll: scroll ?? null,
            to: to ?? null,
            href: href ?? null,
            overlay: overlay ?? null,
        });
    }

    // Pictures that live on someone else's server. Named rather than
    // pathed, because there is no file here to point at, and given a
    // plate of their own so a click can lead somewhere - which is the
    // whole reason not to link straight out to the image.
    const embeds = new Map();
    for (const [name, value] of Object.entries(doc.embeds ?? {})) {
        if (!value || typeof value !== 'object') {
            throw new Error(`embeds.${name} must be a mapping.`);
        }
        const { title, src, to, href, frame, cover } = value;
        if (typeof src !== 'string' || !/^https:\/\//.test(src)) {
            throw new Error(`embeds.${name}.src must be an https URL.`);
        }
        // Where clicking it leads. Left unset, the plate returns the
        // reader to the poem they came from - the same default an image
        // plate has, and the right one when the picture illustrates the
        // poem rather than pointing away from it.
        const targets = [to, href].filter((t) => t !== undefined);
        if (targets.length > 1) {
            throw new Error(`embeds.${name} needs at most one of "to" or "href".`);
        }
        if (to !== undefined && !poems.has(to)) {
            throw new Error(`embeds.${name}.to names an unknown poem: "${to}".`);
        }
        if (frame !== undefined && frame !== 'iframe' && frame !== 'image') {
            throw new Error(`embeds.${name}.frame must be "iframe" or "image".`);
        }
        // Whether clicking anywhere on the frame returns the reader.
        // On by default, which is what an image wants; a page meant to
        // be read needs it off, or it cannot even be scrolled.
        if (cover !== undefined && typeof cover !== 'boolean') {
            throw new Error(`embeds.${name}.cover must be true or false.`);
        }
        if (cover !== undefined && (frame ?? 'iframe') !== 'iframe') {
            throw new Error(`embeds.${name}.cover applies to "frame: iframe"; an image is its own link.`);
        }
        embeds.set(name, {
            title: title ?? name,
            src,
            to: to ?? null,
            href: href ?? null,
            frame: frame ?? 'iframe',
            cover: cover ?? true,
        });
    }

    const rawLinks = doc.links ?? [];
    if (!Array.isArray(rawLinks)) throw new Error('links.yml: "links" must be a list.');

    const links = rawLinks.map((link, i) => {
        const where = `links[${i}]`;
        if (!link || typeof link !== 'object') throw new Error(`${where} is not a mapping.`);
        const { from, phrase, to, href, asset, embed } = link;
        if (typeof from !== 'string' || !from) throw new Error(`${where} needs "from".`);
        if (typeof phrase !== 'string' || !phrase.trim()) throw new Error(`${where} needs "phrase".`);
        if (!poems.has(from)) throw new Error(`${where}.from names an unknown poem: "${from}".`);

        const destinations = [to, href, asset, embed].filter((d) => d !== undefined);
        if (destinations.length !== 1) {
            throw new Error(`${where} needs exactly one of "to", "href", "asset" or "embed".`);
        }
        if (to !== undefined && !poems.has(to)) {
            throw new Error(`${where}.to names an unknown poem: "${to}".`);
        }
        if (embed !== undefined && !embeds.has(embed)) {
            throw new Error(`${where}.embed names an unknown embed: "${embed}".`);
        }
        return { from, phrase, to, href, asset, embed, where };
    });

    // The same phrase linked twice in one poem is a copy-paste slip: the
    // second entry can never match, because the first already consumed
    // the only occurrence a valid anchor is allowed to have.
    const seenAnchors = new Set();
    for (const link of links) {
        const key = `${link.from} ${link.phrase}`;
        if (seenAnchors.has(key)) {
            throw new Error(`${link.where} repeats the anchor "${link.phrase}" in "${link.from}".`);
        }
        seenAnchors.add(key);
    }

    return { poems, assets, embeds, links };
}

/**
 * Works out where each link should point, given what this sync actually
 * published.
 *
 * @param {{poems: Map, links: Array}} ledger
 * @param {{
 *   pathForDoc: (docId: string) => string|undefined,
 *   assetExists: (path: string) => boolean,
 * }} world
 * @returns {{ bySource: Map<string, Array<object>>, pending: Array<object>, missingAssets: Array<object> }}
 */
export function resolveLedger(ledger, { pathForDoc, assetExists }) {
    const bySource = new Map();
    const pending = [];
    const missingAssets = [];

    for (const link of ledger.links) {
        const sourceDoc = ledger.poems.get(link.from).doc;
        const sourcePath = pathForDoc(sourceDoc);
        if (!sourcePath) {
            // The poem carrying the anchor is not published; there is no
            // page to write into. Not an error - it will resolve when
            // the poem is published.
            pending.push({ ...link, why: `"${link.from}" is not published` });
            continue;
        }

        let target;
        if (link.to !== undefined) {
            target = pathForDoc(ledger.poems.get(link.to).doc);
            if (!target) {
                pending.push({ ...link, why: `"${link.to}" is not published` });
                continue;
            }
            target = { kind: 'poem', path: target };
        } else if (link.asset !== undefined) {
            if (!assetExists(link.asset)) {
                missingAssets.push({ ...link, why: `asset "${link.asset}" is not in the repo` });
                continue;
            }
            target = { kind: 'asset', path: link.asset };
        } else if (link.embed !== undefined) {
            const embed = ledger.embeds.get(link.embed);
            // The plate has to lead somewhere. If that poem is not
            // published there is no plate worth making, so the link waits
            // exactly as a link straight to the poem would.
            if (embed.to && !pathForDoc(ledger.poems.get(embed.to).doc)) {
                pending.push({ ...link, why: `"${embed.to}" is not published` });
                continue;
            }
            target = { kind: 'embed', name: link.embed };
        } else {
            target = { kind: 'external', url: link.href };
        }

        const list = bySource.get(sourcePath) ?? [];
        list.push({ ...link, target });
        bySource.set(sourcePath, list);
    }

    return { bySource, pending, missingAssets };
}

/**
 * The href to write for a resolved target, from the page carrying it.
 *
 * Poem and asset targets are stored root-relative in the ledger and made
 * relative here, because pages sit at different depths - a stored
 * relative path would be wrong for every page but one. Both encodings
 * apply: percent-encoding for the spaces in "1. Winter", HTML escaping
 * for the ampersand in "2018-2019&".
 *
 * @param {{kind: string, path?: string, url?: string}} target
 * @param {string} fromDir - repo-relative directory of the page being written.
 * @returns {string} ready to place inside href="...".
 */
export function hrefFor(target, fromDir) {
    if (target.kind === 'external') return escapeHtml(target.url);
    const rel = path.posix.relative(fromDir || '.', target.path) || target.path;
    return escapeHtml(encodeURI(rel));
}

/**
 * The endpoint the poems report to.
 *
 * One crossing is one row. Workers KV has no atomic increment and
 * settles eventually, so counting into a single key per edge would lose
 * writes whenever two readers moved at once. An append-only row cannot
 * race with itself; the counting is done later, by whoever reads.
 *
 * What is stored is an edge and a moment: which page, which words,
 * where they led. No identifier, no session, no cookie, no address.
 * Two readers crossing the same link are indistinguishable here, which
 * is the point - this is meant to say which paths through the poems get
 * walked, not who walked them.
 */

// The collection, and nowhere else. A browser will happily post from
// any page that asks it to; this is what makes the store the site's.
const ALLOWED_ORIGINS = ['https://manonthesea.github.io'];

const MAX_BODY = 1024; // a crossing is a couple of paths and a phrase
const MAX_FIELD = 300;
const KEEP_FOR = 60 * 60 * 24 * 365; // rows expire after a year

function corsHeaders(origin) {
    return {
        'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
    };
}

const clip = (value) => (typeof value === 'string' ? value.slice(0, MAX_FIELD) : '');

export default {
    async fetch(request, env) {
        const origin = request.headers.get('Origin') || '';
        const headers = corsHeaders(origin);

        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers });
        }

        // Asking whether the thing is alive. It says nothing about who
        // has been reading, so it needs no protecting.
        if (request.method === 'GET') {
            return new Response(JSON.stringify({ ok: true }), {
                headers: { ...headers, 'Content-Type': 'application/json' },
            });
        }

        if (request.method !== 'POST') {
            return new Response('Method not allowed', { status: 405, headers });
        }

        if (origin && !ALLOWED_ORIGINS.includes(origin)) {
            return new Response('Not allowed', { status: 403, headers });
        }

        let crossing;
        try {
            crossing = JSON.parse((await request.text()).slice(0, MAX_BODY));
        } catch {
            return new Response('Bad request', { status: 400, headers });
        }

        const from = clip(crossing && crossing.from);
        const to = clip(crossing && crossing.to);
        if (!from || !to) {
            return new Response('Bad request', { status: 400, headers });
        }

        const phrase = clip(crossing && crossing.phrase);

        // Said before the write rather than after it, so a crossing that
        // arrives but fails to store still shows up here. Between this
        // line and the response code, the two halves can be told apart:
        // a line with no 204 after it is a write that did not land.
        //
        // The same edge that goes into the store, and nothing more - the
        // log is no more revealing than the rows are.
        console.log(`${from} -> ${to} ("${phrase}")`);

        // Fixed width, so listing the keys in order lists the crossings
        // in the order they happened.
        const at = Date.now();
        const key = `e:${String(at).padStart(15, '0')}:${crypto.randomUUID().slice(0, 8)}`;

        await env.TRAIL.put(
            key,
            JSON.stringify({ from, to, phrase, at }),
            { expirationTtl: KEEP_FOR }
        );

        // sendBeacon discards the response, so there is no sense
        // spending bytes on one.
        return new Response(null, { status: 204, headers });
    },
};

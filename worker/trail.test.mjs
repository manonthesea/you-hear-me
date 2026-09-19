// Tests for the endpoint the poems report to.
//
// The Worker runs on Cloudflare, not here, but it is plain module code
// over the standard Request and Response, so it can be called directly
// with a stand-in for the KV binding. That is enough to hold the two
// things worth holding: that it refuses what it should refuse, and that
// a crossing it accepts is stored in the shape a later reader expects.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import worker from './trail.js';

const ORIGIN = 'https://manonthesea.github.io';

// A stand-in for the KV namespace, which keeps what it is given.
function fakeStore() {
    const rows = new Map();
    return { rows, binding: { TRAIL: { put: async (key, value) => rows.set(key, value) } } };
}

const post = (body, origin = ORIGIN) =>
    new Request('https://trail.example/', {
        method: 'POST',
        headers: { Origin: origin },
        body,
    });

const crossing = (extra = {}) =>
    JSON.stringify({ from: '/a.html', to: '/b.html', phrase: 'semblance', ...extra });

test('a GET says it is alive, and says nothing else', async () => {
    // This is what a browser is pointed at to check a deploy took, so it
    // has to answer without touching the store.
    const { rows, binding } = fakeStore();

    const res = await worker.fetch(new Request('https://trail.example/'), binding);

    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(await res.text()), { ok: true });
    assert.equal(rows.size, 0, 'a GET wrote to the store');
});

test('a preflight is answered, and any other method is not', async () => {
    const { binding } = fakeStore();

    const preflight = await worker.fetch(
        new Request('https://trail.example/', { method: 'OPTIONS' }),
        binding
    );
    assert.equal(preflight.status, 204);

    const put = await worker.fetch(new Request('https://trail.example/', { method: 'PUT' }), binding);
    assert.equal(put.status, 405);
});

test('a crossing from anywhere but the collection is refused', async () => {
    // Any page at all can ask a browser to post here; this is what makes
    // the store the site's rather than anyone's.
    const { rows, binding } = fakeStore();

    const res = await worker.fetch(post(crossing(), 'https://evil.example'), binding);

    assert.equal(res.status, 403);
    assert.equal(rows.size, 0);
});

test('a body that is not a crossing is refused rather than stored', async () => {
    const { rows, binding } = fakeStore();

    for (const body of ['not json', '{}', '{"from":"/a.html"}', '{"to":"/b.html"}']) {
        const res = await worker.fetch(post(body), binding);
        assert.equal(res.status, 400, `accepted ${body}`);
    }
    assert.equal(rows.size, 0);
});

test('a crossing is stored whole, under a key that sorts by when', async () => {
    const { rows, binding } = fakeStore();

    const res = await worker.fetch(post(crossing()), binding);

    assert.equal(res.status, 204);
    assert.equal(rows.size, 1);

    const [[key, value]] = [...rows];
    // Fixed-width time, so listing the keys in order lists the crossings
    // in the order they happened.
    assert.match(key, /^e:\d{15}:[0-9a-f]{8}$/);

    const row = JSON.parse(value);
    assert.equal(row.from, '/a.html');
    assert.equal(row.to, '/b.html');
    assert.equal(row.phrase, 'semblance');
    assert.ok(Number.isFinite(row.at));
});

test('a crossing carries no more than the edge it is', async () => {
    // Anything the page sends beyond from, to and phrase is dropped
    // here rather than stored and regretted later.
    const { rows, binding } = fakeStore();

    await worker.fetch(post(crossing({ reader: 'someone', ip: '203.0.113.1' })), binding);

    const [row] = [...rows.values()].map((v) => JSON.parse(v));
    assert.deepEqual(Object.keys(row).sort(), ['at', 'from', 'phrase', 'to']);
});

test('a long field inside a sane body is clipped, not stored at length', async () => {
    const { rows, binding } = fakeStore();

    await worker.fetch(post(crossing({ phrase: 'x'.repeat(400) })), binding);

    const [row] = [...rows.values()].map((v) => JSON.parse(v));
    assert.equal(row.phrase.length, 300);
});

test('a body too big to be a crossing is refused, not trimmed into one', async () => {
    // The whole body is cut at 1024 bytes before it is parsed, so an
    // oversized one stops being JSON and is rejected. The field clip
    // above only ever applies to a body that fitted. Worth stating,
    // because the two look like the same guard and are not.
    const { rows, binding } = fakeStore();

    const res = await worker.fetch(post(crossing({ phrase: 'x'.repeat(5000) })), binding);

    assert.equal(res.status, 400);
    assert.equal(rows.size, 0);
});

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import createHandler from '../api/create-planet.js';
import planetsHandler from '../api/planets.js';
import reportHandler from '../api/report.js';
import { decodeArtwork, MAX_ARTWORK_BYTES } from '../lib/validate-image.js';
import { _resetForTests } from '../lib/reports/store.js';

// Handlers are tested directly with fabricated req/res and a stubbed
// global fetch standing in for PostgREST/Storage. Live-database behavior
// (RLS, the report_planet RPC, restart persistence) requires a real
// Supabase project -- see the manual checklist in the README.

const realFetch = globalThis.fetch;
const ENV_KEYS = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'REPORT_IP_SALT', 'VERCEL_ENV'];
const savedEnv = {};

beforeEach(() => {
  _resetForTests();
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
});
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

function mockRes() {
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
  return res;
}

const tinyPngB64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==' +
  'A'.repeat(90);
const tinyPng = 'data:image/png;base64,' + tinyPngB64;
const REF = '123e4567-e89b-42d3-a456-426614174000';

function baseBody() {
  return {
    clientRef: REF,
    name: 'test world',
    image: tinyPng,
    star: { id: 1, type: 'yellow', seed: 0.5, x: 1, y: 2, z: 3 },
    position: { x: 10, y: 0, z: 20 },
    orbit: { radius: 50, angle: 1, speed: 0.05, incl: 0.1, node: 0.2 },
    satelliteType: 'moons',
    satelliteConfig: { moons: [{ size: 0.2, dist: 2, speed: 0.5, phase: 0 }] },
    surfaceType: 'soft',
    scale: 2.4,
    rotationSpeed: 0.12,
    tilt: 0.25,
  };
}

function supaEnv() {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
}

// records every call so tests can assert on paths/payloads
function stubFetch(routes) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    for (const [match, responder] of routes) {
      if (String(url).includes(match)) {
        const out = typeof responder === 'function' ? responder(url, options) : responder;
        return {
          ok: out.status < 400,
          status: out.status,
          text: async () => (out.json === undefined ? '' : JSON.stringify(out.json)),
        };
      }
    }
    return { ok: false, status: 404, text: async () => '' };
  };
  return calls;
}

// ---------------- create-planet ----------------

test('create: unconfigured backend responds fallback (local-only mode)', async () => {
  for (const k of ENV_KEYS) delete process.env[k];
  const res = mockRes();
  await createHandler({ method: 'POST', headers: {}, body: baseBody() }, res);
  assert.equal(res.body.fallback, true);
});

test('create: happy path inserts, uploads, sets artwork_path', async () => {
  supaEnv();
  const calls = stubFetch([
    ['rest/v1/stars', { status: 201 }],
    ['rest/v1/planets?id=eq.', { status: 204 }],
    ['rest/v1/planets', { status: 201, json: [{ id: 'p-1', name: 'test world', created_at: '2026-08-19T00:00:00Z' }] }],
    ['storage/v1/object/planet-artwork/', { status: 200 }],
  ]);
  const res = mockRes();
  await createHandler({ method: 'POST', headers: {}, body: baseBody() }, res);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.planet.id, 'p-1');
  assert.ok(res.body.planet.artworkUrl.includes('planet-artwork/planets/p-1.png'));
  const upload = calls.find((c) => c.url.includes('storage/v1/object/planet-artwork/planets/p-1.png'));
  assert.ok(upload, 'artwork uploaded to storage, not the database');
  assert.equal(upload.options.headers['x-upsert'], 'false');
});

test('create: artwork upload failure deletes the planet row (no broken planets)', async () => {
  supaEnv();
  const calls = stubFetch([
    ['rest/v1/stars', { status: 201 }],
    ['storage/v1/object/planet-artwork/', { status: 500 }],
    ['rest/v1/planets?id=eq.p-2', { status: 204 }],
    ['rest/v1/planets', { status: 201, json: [{ id: 'p-2', name: 'x', created_at: '2026-08-19T00:00:00Z' }] }],
  ]);
  const res = mockRes();
  await createHandler({ method: 'POST', headers: {}, body: baseBody() }, res);
  assert.equal(res.statusCode, 500);
  const del = calls.find((c) => c.url.includes('planets?id=eq.p-2') && c.options.method === 'DELETE');
  assert.ok(del, 'row cleaned up after failed upload');
});

test('create: duplicate clientRef returns the existing planet (idempotent)', async () => {
  supaEnv();
  stubFetch([
    ['rest/v1/stars', { status: 201 }],
    ['rest/v1/planets?client_ref=eq.', { status: 200, json: [{ id: 'p-first', name: 'test world', created_at: '2026-08-19T00:00:00Z', artwork_path: 'planets/p-first.png' }] }],
    ['rest/v1/planets', { status: 409, json: { message: 'duplicate' } }],
  ]);
  const res = mockRes();
  await createHandler({ method: 'POST', headers: {}, body: baseBody() }, res);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.deduplicated, true);
  assert.equal(res.body.planet.id, 'p-first');
});

test('create: rejects bad names, refs, artwork', async () => {
  supaEnv();
  stubFetch([]);
  for (const bad of [
    { ...baseBody(), name: '' },
    { ...baseBody(), clientRef: 'not-a-uuid' },
    { ...baseBody(), image: 'https://example.com/x.png' },
    { ...baseBody(), image: 'data:image/png;base64,' + 'A'.repeat(Math.ceil((MAX_ARTWORK_BYTES * 4) / 3) + 100) },
  ]) {
    const res = mockRes();
    await createHandler({ method: 'POST', headers: {}, body: bad }, res);
    assert.equal(res.statusCode, 400, JSON.stringify(bad).slice(0, 60));
  }
});

// ---------------- planets (public universe query) ----------------

test('planets: only requests visible rows and maps renderer fields', async () => {
  supaEnv();
  const calls = stubFetch([
    ['rest/v1/planets', {
      status: 200,
      json: [{
        id: 'p-9', name: 'shared world', created_at: '2026-08-01T00:00:00Z',
        artwork_path: 'planets/p-9.png', star_id: 2,
        position_x: 1, position_y: 2, position_z: 3,
        orbit_radius: 40, orbit_angle: 0.5, orbit_speed: 0.05, orbit_inclination: 0.1, orbit_node: 0,
        satellite_type: 'rings', satellite_config: { rings: {} }, surface_type: 'soft',
        vibe: null, scale: 2.4, rotation_speed: 0.1, tilt: 0.2,
      }],
    }],
  ]);
  const res = mockRes();
  await planetsHandler({ method: 'GET', headers: {} }, res);
  assert.equal(res.body.planets.length, 1);
  assert.equal(res.body.planets[0].satelliteType, 'rings');
  assert.ok(res.body.planets[0].artworkUrl.includes('planet-artwork/planets/p-9.png'));
  const q = calls[0].url;
  assert.ok(q.includes('status=eq.visible'), 'hidden planets are excluded at the query');
});

// ---------------- report ----------------

test('report: Supabase mode sends an HMAC hash, never the raw IP', async () => {
  supaEnv();
  process.env.REPORT_IP_SALT = 'unit-salt';
  const calls = stubFetch([
    ['rest/v1/rpc/report_planet', { status: 200, json: [{ added: true, hidden: false }] }],
  ]);
  const res = mockRes();
  await reportHandler({
    method: 'POST',
    headers: { 'x-forwarded-for': '198.51.100.7' },
    body: { planetId: REF, ip: 'attacker-supplied-should-be-ignored' },
  }, res);
  assert.equal(res.body.ok, true);
  const rpc = calls.find((c) => c.url.includes('rpc/report_planet'));
  const payload = JSON.parse(rpc.options.body);
  assert.equal(payload.p_planet_id, REF);
  assert.ok(!payload.p_ip_hash.includes('198.51.100.7'), 'raw IP never sent');
  assert.ok(!JSON.stringify(payload).includes('attacker-supplied'), 'body ip ignored');
});

test('report: fallback mode hides after three unique IPs, end to end', async () => {
  for (const k of ENV_KEYS) delete process.env[k];
  const send = async (ip) => {
    const res = mockRes();
    await reportHandler({ method: 'POST', headers: { 'x-forwarded-for': ip }, body: { planetId: REF } }, res);
    return res.body;
  };
  assert.equal((await send('1.1.1.1')).hidden, false);
  assert.equal((await send('1.1.1.1')).hidden, false); // duplicate source
  assert.equal((await send('2.2.2.2')).hidden, false);
  assert.equal((await send('3.3.3.3')).hidden, true);  // third unique source
});

test('report: invalid planet ids are rejected', async () => {
  const res = mockRes();
  await reportHandler({ method: 'POST', headers: {}, body: { planetId: 'nope' } }, res);
  assert.equal(res.statusCode, 400);
});

// ---------------- production strictness: one source of truth ----------------

test('production: unconfigured create refuses instead of falling back', async () => {
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.VERCEL_ENV = 'production';
  const res = mockRes();
  await createHandler({ method: 'POST', headers: {}, body: baseBody() }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, 'universe_unavailable');
});

test('production: unconfigured report refuses — never a fake success', async () => {
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.VERCEL_ENV = 'production';
  const res = mockRes();
  await reportHandler({ method: 'POST', headers: { 'x-forwarded-for': '1.1.1.1' }, body: { planetId: REF } }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.ok, undefined);
});

test('production: report with failing database refuses instead of quiet-ok', async () => {
  supaEnv();
  process.env.VERCEL_ENV = 'production';
  stubFetch([
    ['rest/v1/rpc/report_planet', { status: 500, json: { message: 'down' } }],
  ]);
  const res = mockRes();
  await reportHandler({ method: 'POST', headers: { 'x-forwarded-for': '1.1.1.1' }, body: { planetId: REF } }, res);
  assert.equal(res.statusCode, 503);
});

test('production: unconfigured planets query flags unavailable', async () => {
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.VERCEL_ENV = 'production';
  const res = mockRes();
  await planetsHandler({ method: 'GET', headers: {} }, res);
  assert.equal(res.body.unavailable, true);
  assert.deepEqual(res.body.planets, []);
});

test('development: unconfigured behavior is unchanged (fallbacks intact)', async () => {
  for (const k of ENV_KEYS) delete process.env[k];
  const resCreate = mockRes();
  await createHandler({ method: 'POST', headers: {}, body: baseBody() }, resCreate);
  assert.equal(resCreate.body.fallback, true);
  const resReport = mockRes();
  await reportHandler({ method: 'POST', headers: { 'x-forwarded-for': '5.5.5.5' }, body: { planetId: REF } }, resReport);
  assert.equal(resReport.body.ok, true);
});

// ---------------- key hygiene ----------------

test('service-role key never appears in any client-side source file', async () => {
  const { readFileSync, readdirSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  const offenders = [];
  const walk = (dir) => {
    for (const f of readdirSync(dir)) {
      const full = join(dir, f);
      if (statSync(full).isDirectory()) walk(full);
      else if (/SERVICE_ROLE/i.test(readFileSync(full, 'utf8'))) offenders.push(full);
    }
  };
  walk(new URL('../src', import.meta.url).pathname);
  assert.deepEqual(offenders, [], 'src/ must never reference the service-role key');
});

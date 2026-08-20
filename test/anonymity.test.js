import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import createHandler from '../api/create-planet.js';
import { hashCreatorIp } from '../lib/reports/hash.js';

// Planet creation stays anonymous in the ways that matter: no accounts, no
// profiles, no cookies, no device fingerprints, and the raw IP is NEVER stored
// or sent to the database. The ONE piece of creator data is a one-way HMAC of
// the request IP, used ONLY to enforce one planet per network (migration 004).
// It is domain-separated from the reporter identity, so the two cannot be
// linked. These tests lock those properties so they can't silently regress.

const realFetch = globalThis.fetch;
const ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'REPORT_IP_SALT', 'VERCEL_ENV'];
const saved = {};
beforeEach(() => { for (const k of ENV) saved[k] = process.env[k]; });
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

function supaEnv() {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
}
function mockRes() {
  return { statusCode: null, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, setHeader() {} };
}
const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==' + 'A'.repeat(90);
function body(clientRef) {
  return {
    clientRef, name: 'a world', image: tinyPng,
    candidates: [{ id: 0, type: 'blue', seed: 1, x: 1, y: 2, z: 3, radius: 14, plane_incl: 0.1, plane_node: 0.2 }],
    extent: 5, satelliteType: 'none', surfaceType: 'soft', scale: 2.4, rotationSpeed: 0.12, tilt: 0.25,
  };
}
function stub(recordCalls) {
  globalThis.fetch = async (url, options = {}) => {
    recordCalls.push({ url: String(url), options });
    if (String(url).includes('rpc/assign_planet')) {
      return { ok: true, status: 200, text: async () => JSON.stringify([{
        planet_id: 'p-' + Math.random().toString(36).slice(2, 8), created_at: '2026-08-19T00:00:00Z', deduplicated: false,
        star_id: 0, star_type: 'blue', star_seed: 1, star_radius: 14, star_x: 1, star_y: 2, star_z: 3,
        star_plane_incl: 0.1, star_plane_node: 0.2, star_is_new: false,
        o_radius: 46, o_angle: 1, o_speed: 0.05, o_incl: 0.1, o_node: 0.2, name_taken: false, planet_limit_reached: false,
      }]) };
    }
    return { ok: true, status: 200, text: async () => '' }; // storage upload
  };
}

// -------- the creator identity is derived server-side, never smuggled --------

test('creation derives the creator identity from trusted headers, ignoring client-supplied fields', async () => {
  supaEnv();
  const calls = [];
  stub(calls);
  const res = mockRes();
  const HEADER_IP = '203.0.113.9';
  await createHandler({
    method: 'POST',
    // a client trying to smuggle a different identity via body/cookie is ignored
    headers: { 'x-forwarded-for': `${HEADER_IP}, 10.0.0.1`, cookie: 'id=abc' },
    body: { ...body('44444444-4444-4444-8444-444444444444'), ip: '9.9.9.9', deviceId: 'dev-1', creatorId: 'c-1', fingerprint: 'fp-1' },
  }, res);
  assert.equal(res.body.ok, true);

  const rpc = calls.find((c) => c.url.includes('rpc/assign_planet'));
  const sent = JSON.parse(rpc.options.body);
  // the creator identity is the HMAC of the trusted header IP -- not the body
  assert.equal(sent.p_creator_ip_hash, hashCreatorIp(HEADER_IP));
  assert.match(sent.p_creator_ip_hash, /^[0-9a-f]{32}$/);
  // none of the smuggled or raw values reach the backend
  const serialized = JSON.stringify(sent).toLowerCase();
  for (const forbidden of ['203.0.113.9', '9.9.9.9', 'deviceid', 'creatorid', 'fingerprint', 'cookie', 'dev-1', 'c-1', 'fp-1', 'reporter']) {
    assert.equal(serialized.includes(forbidden), false, `creation payload must not contain "${forbidden}"`);
  }
});

test('creation never sends a raw IP to the backend or storage', async () => {
  supaEnv();
  const calls = [];
  stub(calls);
  const res = mockRes();
  const RAW = '198.51.100.23';
  await createHandler({ method: 'POST', headers: { 'x-real-ip': RAW }, body: body('55555555-5555-4555-8555-555555555555') }, res);
  assert.equal(res.body.ok, true);
  for (const c of calls) {
    const bodyStr = typeof c.options.body === 'string' ? c.options.body : '';
    assert.equal(bodyStr.includes(RAW), false, `raw IP must not appear in a request to ${c.url}`);
  }
});

test('the planet record carries only world-state fields, nothing identifying', async () => {
  supaEnv();
  const calls = [];
  stub(calls);
  const res = mockRes();
  await createHandler({ method: 'POST', headers: { 'x-real-ip': '203.0.113.1' }, body: body('66666666-6666-4666-8666-666666666666') }, res);
  const rpc = calls.find((c) => c.url.includes('rpc/assign_planet'));
  const sent = JSON.parse(rpc.options.body);
  // the creator hash is a SEPARATE top-level RPC arg, never mixed into the planet
  const planetKeys = Object.keys(sent.p_planet).sort();
  assert.deepEqual(planetKeys, ['artwork_path', 'name', 'rotation_speed', 'satellite_config', 'satellite_type', 'scale', 'surface_type', 'tilt', 'vibe'].sort());
});

// -------- creator identity is separate from the reporter identity --------

test('creation uses the creator identity (hashCreatorIp), NOT the reporter identity', () => {
  const createSrc = readFileSync(new URL('../api/create-planet.js', import.meta.url), 'utf8');
  assert.match(createSrc, /hashCreatorIp/, 'creation derives a creator-scoped hash');
  assert.equal(/hashReporterIp|reporter_ip/.test(createSrc), false, 'creation never uses the reporter identity');
  // no device / cookie / fingerprint fallbacks
  assert.equal(/fingerprint|deviceId|navigator\.userAgent|document\.cookie/i.test(createSrc), false);
});

test('reporting still uses its own reporter identity, unchanged', () => {
  const reportSrc = readFileSync(new URL('../api/report.js', import.meta.url), 'utf8');
  assert.match(reportSrc, /hashReporterIp/, 'reporting still hashes the reporter IP');
  assert.equal(/hashCreatorIp/.test(reportSrc), false, 'reporting does not use the creator identity');
});

test('the browser client handles no IP or identity itself (creator identity is server-only)', () => {
  const clientSrc = readFileSync(new URL('../src/backend/client.js', import.meta.url), 'utf8');
  assert.equal(/reports\/ip|reports\/hash|hashReporterIp|hashCreatorIp|reporterIp|fingerprint|deviceId|navigator\.userAgent|document\.cookie/i.test(clientSrc), false);
});

// -------- the schema keeps only a one-way hash, no owner/device columns --------

test('the only creator data on planets is a one-way hash; no owner / device / raw-IP column', () => {
  const schema = readFileSync(new URL('../supabase/migrations/001_initial_schema.sql', import.meta.url), 'utf8')
    + readFileSync(new URL('../supabase/migrations/002_star_capacity.sql', import.meta.url), 'utf8')
    + readFileSync(new URL('../supabase/migrations/004_creator_ip_limit.sql', import.meta.url), 'utf8');
  // the creator column exists and is explicitly a HASH, protected by a unique index
  assert.match(schema, /creator_ip_hash\s+text/, 'planets stores a creator_ip_hash column');
  assert.match(schema, /planets_creator_ip_hash_uidx/, 'the one-planet rule is a database unique index');
  // no account / device / raw-IP identity is stored
  for (const forbidden of ['owner', 'user_id', 'device', 'fingerprint', 'cookie', 'creator_ip_addr', 'creator_ip text']) {
    assert.equal(new RegExp(forbidden, 'i').test(schema), false, `schema must not store "${forbidden}"`);
  }
  // reporting keeps its own hashed IP (the other, separate IP-derived value)
  assert.match(schema, /reporter_ip_hash/, 'reporting still stores hashed reporter IPs');
});

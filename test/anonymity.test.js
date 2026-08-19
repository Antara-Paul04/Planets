import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import createHandler from '../api/create-planet.js';

// Planet creation is completely anonymous and unrestricted: anyone can create
// as many planets as they want, and nothing about the creator (IP, device,
// cookie, token, account) is ever collected or stored. These tests lock that
// invariant so it can never silently regress. The ONLY IP-derived data in the
// whole app lives in the reporting system (see reports.test.js).

const realFetch = globalThis.fetch;
const ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VERCEL_ENV'];
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
  return {
    statusCode: null, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    setHeader() {},
  };
}
const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==' + 'A'.repeat(90);
function body(clientRef) {
  return {
    clientRef,
    name: 'a world',
    image: tinyPng,
    candidates: [{ id: 0, type: 'blue', seed: 1, x: 1, y: 2, z: 3, radius: 14, plane_incl: 0.1, plane_node: 0.2 }],
    extent: 5,
    satelliteType: 'none', surfaceType: 'soft', scale: 2.4, rotationSpeed: 0.12, tilt: 0.25,
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
        o_radius: 46, o_angle: 1, o_speed: 0.05, o_incl: 0.1, o_node: 0.2,
      }]) };
    }
    return { ok: true, status: 200, text: async () => '' }; // storage upload
  };
}

// ---------------- multiple planets from the same "browser" ----------------

test('1-3. the same client can create many planets, each independently accepted', async () => {
  supaEnv();
  const calls = [];
  stub(calls);
  const results = [];
  // three fresh clientRefs (as crypto.randomUUID() produces per creation)
  for (const ref of [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
  ]) {
    const res = mockRes();
    await createHandler({ method: 'POST', headers: {}, body: body(ref) }, res);
    results.push(res);
  }
  assert.equal(results.every((r) => r.body.ok === true), true, 'every creation is allowed');
  const ids = results.map((r) => r.body.planet.id);
  assert.equal(new Set(ids).size, 3, 'three distinct planets created — no uniqueness rejection');
  // no request ever carried a reporter-IP header or asked for one
  assert.equal(calls.some((c) => (c.options.headers || {})['x-forwarded-for'] || (c.options.headers || {})['x-real-ip']), false);
});

// ---------------- no creator identity reaches the database ----------------

test('4-6. the creation payload the DB receives has NO creator / IP / device / token field', async () => {
  supaEnv();
  const calls = [];
  stub(calls);
  const res = mockRes();
  await createHandler({
    method: 'POST',
    // even if a client tries to smuggle identity in headers or body, it is ignored
    headers: { 'x-forwarded-for': '203.0.113.9', 'x-real-ip': '203.0.113.9', cookie: 'id=abc' },
    body: { ...body('44444444-4444-4444-8444-444444444444'), ip: '203.0.113.9', deviceId: 'dev-1', creatorId: 'c-1', fingerprint: 'fp-1' },
  }, res);
  assert.equal(res.body.ok, true);

  const rpc = calls.find((c) => c.url.includes('rpc/assign_planet'));
  const sent = JSON.parse(rpc.options.body);
  const serialized = JSON.stringify(sent).toLowerCase();
  for (const forbidden of ['reporter', 'ip_hash', 'ipaddr', 'deviceid', 'creatorid', 'fingerprint', 'cookie', '203.0.113.9', 'dev-1', 'c-1', 'fp-1']) {
    assert.equal(serialized.includes(forbidden), false, `creation payload must not contain "${forbidden}"`);
  }
  // the planet object carries only world-state fields, nothing identifying
  const planetKeys = Object.keys(sent.p_planet).sort();
  assert.deepEqual(planetKeys, ['artwork_path', 'name', 'rotation_speed', 'satellite_config', 'satellite_type', 'scale', 'surface_type', 'tilt', 'vibe'].sort());
});

// ---------------- source-level guards (belt and braces) ----------------

test('the creation code imports no IP / identity machinery', () => {
  const createSrc = readFileSync(new URL('../api/create-planet.js', import.meta.url), 'utf8');
  const clientSrc = readFileSync(new URL('../src/backend/client.js', import.meta.url), 'utf8');
  for (const src of [createSrc, clientSrc]) {
    assert.equal(/reports\/ip|reports\/hash|hashReporterIp|reporterIp|fingerprint|deviceId|navigator\.userAgent|document\.cookie/i.test(src), false);
  }
});

test('IP-derived data is confined to the reporting system only', () => {
  // report.js may use it; create-planet.js must not
  const reportSrc = readFileSync(new URL('../api/report.js', import.meta.url), 'utf8');
  const createSrc = readFileSync(new URL('../api/create-planet.js', import.meta.url), 'utf8');
  assert.equal(/reporterIp|hashReporterIp/.test(reportSrc), true, 'reporting still uses IP hashing');
  assert.equal(/reporterIp|hashReporterIp|ip_hash|reporter_ip/i.test(createSrc), false, 'creation never touches IP data');
});

// ---------------- database has no creator relationship ----------------

test('the schema stores no creator / owner / IP / device column on planets', () => {
  const schema = readFileSync(new URL('../supabase/migrations/001_initial_schema.sql', import.meta.url), 'utf8')
    + readFileSync(new URL('../supabase/migrations/002_star_capacity.sql', import.meta.url), 'utf8');
  // isolate the planets table definition
  const planetsTable = schema.slice(schema.indexOf('create table if not exists planets'), schema.indexOf('create index if not exists planets_status_idx'));
  for (const forbidden of ['creator', 'owner', 'user_id', 'reporter_ip', 'device', 'fingerprint', 'cookie']) {
    assert.equal(new RegExp(forbidden, 'i').test(planetsTable), false, `planets table must not have a "${forbidden}" column`);
  }
  // reporting keeps its hashed IP (that is the ONLY IP-derived storage)
  assert.equal(/reporter_ip_hash/.test(schema), true, 'reporting still stores hashed reporter IPs');
});

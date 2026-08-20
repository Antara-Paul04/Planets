import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { createUniverse } from '../lib/creation/limit.js';
import { hashCreatorIp, hashReporterIp } from '../lib/reports/hash.js';
import createHandler from '../api/create-planet.js';

// ---------------------------------------------------------------------------
// Behavior of the one-planet-per-network rule, tested against the in-memory
// model that mirrors assign_planet()'s ordering (migration 004). Same approach
// as reports.test.js, which tests the report rule against lib/reports/store.js.
// ---------------------------------------------------------------------------

const A = hashCreatorIp('203.0.113.7');   // network A
const B = hashCreatorIp('198.51.100.2');  // network B
const star = (id) => [{ id }];

test('1. first planet from network A succeeds', () => {
  const u = createUniverse();
  const r = u.attemptCreate({ clientRef: 'c1', creatorHash: A, name: 'alpha', candidates: star(0) });
  assert.equal(r.ok, true);
  assert.equal(u.planetCount(), 1);
});

test('2. second planet from network A is rejected with planetLimitReached', () => {
  const u = createUniverse();
  u.attemptCreate({ clientRef: 'c1', creatorHash: A, name: 'alpha', candidates: star(0) });
  const r = u.attemptCreate({ clientRef: 'c2', creatorHash: A, name: 'beta', candidates: star(0) });
  assert.equal(r.planetLimitReached, true);
  assert.equal(r.ok, undefined);
  assert.equal(u.planetCount(), 1, 'still exactly one planet');
});

test('3. a planet from network B still succeeds', () => {
  const u = createUniverse();
  u.attemptCreate({ clientRef: 'c1', creatorHash: A, name: 'alpha', candidates: star(0) });
  const r = u.attemptCreate({ clientRef: 'c2', creatorHash: B, name: 'beta', candidates: star(0) });
  assert.equal(r.ok, true);
  assert.equal(u.planetCount(), 2);
});

test('4. same network cannot create a second even with a different clientRef, name, or star', () => {
  const u = createUniverse();
  u.attemptCreate({ clientRef: 'c1', creatorHash: A, name: 'alpha', candidates: star(0) });
  // different client_ref
  assert.equal(u.attemptCreate({ clientRef: 'c2', creatorHash: A, name: 'gamma', candidates: star(0) }).planetLimitReached, true);
  // different name
  assert.equal(u.attemptCreate({ clientRef: 'c3', creatorHash: A, name: 'totally-different', candidates: star(0) }).planetLimitReached, true);
  // different star
  assert.equal(u.attemptCreate({ clientRef: 'c4', creatorHash: A, name: 'elsewhere', candidates: star(99) }).planetLimitReached, true);
  assert.equal(u.planetCount(), 1);
});

test('5. repeating the same clientRef returns the original planet (idempotency, not a limit rejection)', () => {
  const u = createUniverse();
  const first = u.attemptCreate({ clientRef: 'c1', creatorHash: A, name: 'alpha', candidates: star(0) });
  const retry = u.attemptCreate({ clientRef: 'c1', creatorHash: A, name: 'alpha', candidates: star(0) });
  assert.equal(retry.deduplicated, true);
  assert.equal(retry.planetLimitReached, undefined, 'a retry is never rejected as over-limit');
  assert.equal(retry.planet.id, first.planet.id);
  assert.equal(u.planetCount(), 1);
});

test('6. two concurrent attempts from the same network create only one planet', () => {
  const u = createUniverse();
  // JS is single-threaded: the second call sees the first has taken the slot
  const r1 = u.attemptCreate({ clientRef: 'c1', creatorHash: A, name: 'alpha', candidates: star(0) });
  const r2 = u.attemptCreate({ clientRef: 'c2', creatorHash: A, name: 'beta', candidates: star(0) });
  const wins = [r1, r2].filter((r) => r.ok).length;
  const rejected = [r1, r2].filter((r) => r.planetLimitReached).length;
  assert.equal(wins, 1);
  assert.equal(rejected, 1);
  assert.equal(u.planetCount(), 1);
});

test('7. a rejected creation consumes no star capacity', () => {
  const u = createUniverse();
  u.attemptCreate({ clientRef: 'c1', creatorHash: A, name: 'alpha', candidates: star(0) });
  assert.equal(u.starCount(0), 1);
  u.attemptCreate({ clientRef: 'c2', creatorHash: A, name: 'beta', candidates: star(0) }); // rejected
  assert.equal(u.starCount(0), 1, 'star 0 still holds exactly one planet');
});

test('8. a rejected creation mints no new star', () => {
  const u = createUniverse();
  u.attemptCreate({ clientRef: 'c1', creatorHash: A, name: 'alpha', candidates: star(0) });
  assert.equal(u.mintedStars(), 0);
  // empty candidates would force a mint -- but the limit check stops first
  const r = u.attemptCreate({ clientRef: 'c2', creatorHash: A, name: 'beta', candidates: [] });
  assert.equal(r.planetLimitReached, true);
  assert.equal(u.mintedStars(), 0, 'no star was minted for the rejected attempt');
});

// ---------------------------------------------------------------------------
// Insert-time race backstop: another request commits between the pre-checks and
// this insert. This exercises the SQL's unique_violation disambiguation branch
// (client_ref -> existing, creator -> limit, name -> taken) which the pre-check
// path never reaches. `_beforeInsert` injects the concurrent row.
// ---------------------------------------------------------------------------

test('6b. race backstop: a concurrent same-network insert makes the loser return planetLimitReached', () => {
  const u = createUniverse();
  const r = u.attemptCreate({
    clientRef: 'c1', creatorHash: A, name: 'alpha', candidates: star(0),
    _beforeInsert: ({ inject }) => inject({ clientRef: 'c2', creatorHash: A, name: 'won-the-race' }),
  });
  assert.equal(r.planetLimitReached, true);
  assert.equal(r.ok, undefined);
  assert.equal(u.planetCount(), 1, 'only the winner exists');
  assert.equal(u.mintedStars(), 0, 'the loser minted nothing');
});

test('6c. race backstop: a raced retry (same client_ref) returns the existing planet, NOT a limit rejection', () => {
  const u = createUniverse();
  const r = u.attemptCreate({
    clientRef: 'c1', creatorHash: A, name: 'alpha', candidates: star(0),
    // the concurrent winner shares BOTH this client_ref and this creator hash:
    // client_ref must take precedence so a retry is never mis-rejected.
    _beforeInsert: ({ inject }) => inject({ clientRef: 'c1', creatorHash: A, name: 'winner' }),
  });
  assert.equal(r.deduplicated, true);
  assert.equal(r.planetLimitReached, undefined);
  assert.equal(r.planet.clientRef, 'c1');
});

test('6d. race backstop: a concurrent same-name insert makes the loser return nameTaken', () => {
  const u = createUniverse();
  const r = u.attemptCreate({
    clientRef: 'c1', creatorHash: A, name: 'alpha', candidates: star(0),
    _beforeInsert: ({ inject }) => inject({ clientRef: 'c2', creatorHash: B, name: 'ALPHA' }), // same normalized name
  });
  assert.equal(r.nameTaken, true);
  assert.equal(r.planetLimitReached, undefined);
});

// ---------------------------------------------------------------------------
// API layer: the handler derives the creator identity server-side and passes a
// HASH (never the raw IP) to the RPC, and translates planet_limit_reached into
// a clean response with no artwork upload.
// ---------------------------------------------------------------------------

const realFetch = globalThis.fetch;
const ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'REPORT_IP_SALT', 'VERCEL_ENV'];
const saved = {};
beforeEach(() => { for (const k of ENV) saved[k] = process.env[k]; });
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});
function supaEnv() { process.env.SUPABASE_URL = 'https://x.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'k'; }
function mockRes() {
  return { statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, setHeader() {} };
}
const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==' + 'A'.repeat(90);
function body(name = 'a world') {
  return {
    clientRef: '11111111-1111-4111-8111-111111111111', name, image: tinyPng,
    candidates: [{ id: 0, type: 'blue', seed: 1, x: 1, y: 2, z: 3, radius: 14, plane_incl: 0.1, plane_node: 0.2 }],
    extent: 5, satelliteType: 'none', surfaceType: 'soft', scale: 2.4, rotationSpeed: 0.12, tilt: 0.25,
  };
}

test('10. create-planet passes an HMAC of the IP to the RPC -- never the raw IP', async () => {
  supaEnv();
  const RAW_IP = '203.0.113.55';
  let rpcBody = null;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('rpc/assign_planet')) {
      rpcBody = JSON.parse(opts.body);
      return { ok: true, status: 200, text: async () => JSON.stringify([{
        planet_id: 'p1', created_at: '2026-08-21T00:00:00Z', deduplicated: false, star_id: 0,
        star_type: 'blue', star_seed: 1, star_radius: 14, star_x: 1, star_y: 2, star_z: 3,
        star_plane_incl: 0.1, star_plane_node: 0.2, star_is_new: false,
        o_radius: 46, o_angle: 1, o_speed: 0.05, o_incl: 0.1, o_node: 0.2, name_taken: false, planet_limit_reached: false,
      }]) };
    }
    return { ok: true, status: 200, text: async () => '' };
  };
  const res = mockRes();
  await createHandler({ method: 'POST', headers: { 'x-forwarded-for': `${RAW_IP}, 10.0.0.1` }, body: body() }, res);
  assert.equal(res.statusCode, 200);
  assert.ok(rpcBody, 'assign_planet was called');
  assert.match(rpcBody.p_creator_ip_hash, /^[0-9a-f]{32}$/, 'creator identity is a 32-hex HMAC');
  assert.equal(rpcBody.p_creator_ip_hash, hashCreatorIp(RAW_IP), 'derived from the first x-forwarded-for hop');
  // the raw IP must appear in NO request body sent to the backend/storage
  const wholeBody = JSON.stringify(rpcBody);
  assert.equal(wholeBody.includes(RAW_IP), false, 'raw IP is never sent to the database');
});

test('2b. create-planet returns a clean planet_limit_reached (409) and uploads no artwork', async () => {
  supaEnv();
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes('rpc/assign_planet')) {
      return { ok: true, status: 200, text: async () => JSON.stringify([{ planet_id: null, deduplicated: false, star_id: null, name_taken: false, planet_limit_reached: true }]) };
    }
    return { ok: true, status: 200, text: async () => '' };
  };
  const res = mockRes();
  await createHandler({ method: 'POST', headers: { 'x-real-ip': '203.0.113.55' }, body: body() }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'planet_limit_reached');
  assert.equal(calls.some((u) => u.includes('planet-artwork')), false, 'no artwork uploaded when over the limit');
});

test('9. reporting identity is separate from and unaffected by the creation identity', () => {
  const ip = '203.0.113.7';
  // same IP -> different hashes for the two purposes (unlinkable)
  assert.notEqual(hashReporterIp(ip), hashCreatorIp(ip));
  // reporter hash is a stable 32-hex digest (reporting behavior unchanged)
  assert.match(hashReporterIp(ip), /^[0-9a-f]{32}$/);
  assert.equal(hashReporterIp(ip), hashReporterIp(ip));
});

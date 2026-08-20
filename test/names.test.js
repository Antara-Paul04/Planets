import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import createHandler from '../api/create-planet.js';
import { normalizeNameKey } from '../lib/name.js';

// The normalized key must match the SQL used for planets.name_key (migration
// 003). Case-insensitive, trimmed, internal whitespace collapsed.
test('normalizeNameKey: case-insensitive, trims, collapses whitespace', () => {
  assert.equal(normalizeNameKey('  Pinku  Blobu '), 'pinku blobu');
  assert.equal(normalizeNameKey('PINKU'), normalizeNameKey('pinku'));
  assert.equal(normalizeNameKey('a\t b\n c'), 'a b c');
  assert.equal(normalizeNameKey(null), '');
  assert.equal(normalizeNameKey(undefined), '');
});

const realFetch = globalThis.fetch;
const ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VERCEL_ENV'];
const saved = {};
beforeEach(() => { for (const k of ENV) saved[k] = process.env[k]; });
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});
function supaEnv() { process.env.SUPABASE_URL = 'https://x.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'k'; }
function mockRes() {
  return { statusCode: null, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, setHeader() {} };
}
const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==' + 'A'.repeat(90);
function body() {
  return {
    clientRef: '11111111-1111-4111-8111-111111111111', name: 'taken name', image: tinyPng,
    candidates: [{ id: 0, type: 'blue', seed: 1, x: 1, y: 2, z: 3, radius: 14, plane_incl: 0.1, plane_node: 0.2 }],
    extent: 5, satelliteType: 'none', surfaceType: 'soft', scale: 2.4, rotationSpeed: 0.12, tilt: 0.25,
  };
}

test('create-planet rejects a taken name with 409 and uploads no artwork', async () => {
  supaEnv();
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes('rpc/assign_planet')) {
      return { ok: true, status: 200, text: async () => JSON.stringify([{ planet_id: null, created_at: null, deduplicated: false, star_id: null, name_taken: true }]) };
    }
    return { ok: true, status: 200, text: async () => '' };
  };
  const res = mockRes();
  await createHandler({ method: 'POST', headers: {}, body: body() }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'name_taken');
  assert.equal(calls.some((u) => u.includes('planet-artwork')), false, 'no artwork uploaded when the name is rejected');
});

test('create-planet accepts a free name (name_taken false)', async () => {
  supaEnv();
  globalThis.fetch = async (url) => {
    if (String(url).includes('rpc/assign_planet')) {
      return { ok: true, status: 200, text: async () => JSON.stringify([{
        planet_id: 'p1', created_at: '2026-08-20T00:00:00Z', deduplicated: false,
        star_id: 0, star_type: 'blue', star_seed: 1, star_radius: 14, star_x: 1, star_y: 2, star_z: 3,
        star_plane_incl: 0.1, star_plane_node: 0.2, star_is_new: false,
        o_radius: 46, o_angle: 1, o_speed: 0.05, o_incl: 0.1, o_node: 0.2, name_taken: false,
      }]) };
    }
    return { ok: true, status: 200, text: async () => '' };
  };
  const res = mockRes();
  await createHandler({ method: 'POST', headers: {}, body: body() }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
});

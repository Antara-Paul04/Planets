import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { STAR_CAPACITY, capacityForType, DYNAMIC_STAR_ID_BASE, isDynamicStarId } from '../lib/capacity.js';
import planetsHandler from '../api/planets.js';

// The capacity *mapping* is pure and mirrored by the star_capacity() SQL
// function (migration 002); the atomic fill / redirect / new-star / concurrency
// behavior is enforced in Postgres and verified live against the project.
// These tests cover the deterministic mapping and the client-facing query.

test('capacity mapping matches the requested small->large scale', () => {
  assert.equal(capacityForType('blue'), 4);
  assert.equal(capacityForType('white'), 6);
  assert.equal(capacityForType('orange'), 9);
  assert.equal(capacityForType('yellow'), 12);
  assert.equal(capacityForType('red'), 15);
});

test('capacity is ordered by star size (blue smallest, red largest)', () => {
  const byType = ['blue', 'white', 'orange', 'yellow', 'red'].map(capacityForType);
  const sorted = [...byType].sort((a, b) => a - b);
  assert.deepEqual(byType, sorted);
  assert.equal(Math.min(...Object.values(STAR_CAPACITY)), 4);
  assert.equal(Math.max(...Object.values(STAR_CAPACITY)), 15);
});

test('capacity is deterministic — same type always the same number', () => {
  for (const t of Object.keys(STAR_CAPACITY)) {
    assert.equal(capacityForType(t), capacityForType(t));
  }
});

test('unknown types fall back to a safe default, never throw', () => {
  assert.equal(capacityForType('weird'), 6);
  assert.equal(capacityForType(undefined), 6);
});

test('dynamic-star id range is separate from deterministic indices', () => {
  assert.equal(isDynamicStarId(0), false);
  assert.equal(isDynamicStarId(9), false);
  assert.equal(isDynamicStarId(DYNAMIC_STAR_ID_BASE), true);
  assert.equal(isDynamicStarId(DYNAMIC_STAR_ID_BASE + 5), true);
});

// ---------------- planets query returns dynamic stars ----------------

const realFetch = globalThis.fetch;
const ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VERCEL_ENV'];
const saved = {};
beforeEach(() => { for (const k of ENV) saved[k] = process.env[k]; });
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

function mockRes() {
  return {
    statusCode: null, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}

test('planets query returns dynamically-minted stars alongside planets, position from orbit', async () => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('stars?id=gte.1000000')) {
      return { ok: true, status: 200, text: async () => JSON.stringify([{
        id: 1000000, star_type: 'yellow', seed: 42, radius: 20,
        position_x: 22000, position_y: 100, position_z: -30000, plane_incl: 0.3, plane_node: 1.1,
      }]) };
    }
    if (u.includes('planets?status=eq.visible')) {
      return { ok: true, status: 200, text: async () => JSON.stringify([{
        id: 'p-1', name: 'orbiter', created_at: '2026-08-19T00:00:00Z', artwork_path: 'planets/p-1.png',
        star_id: 1000000, position_x: null, position_y: null, position_z: null,
        orbit_radius: 50, orbit_angle: 1, orbit_speed: 0.05, orbit_inclination: 0.3, orbit_node: 1.1,
        satellite_type: 'none', satellite_config: null, surface_type: 'soft', vibe: null,
        scale: 2.4, rotation_speed: 0.1, tilt: 0.2,
      }]) };
    }
    return { ok: false, status: 404, text: async () => '' };
  };
  const res = mockRes();
  await planetsHandler({ method: 'GET', headers: {} }, res);
  assert.equal(res.body.stars.length, 1);
  assert.equal(res.body.stars[0].id, 1000000);
  assert.equal(res.body.stars[0].type, 'yellow');
  assert.equal(res.body.planets.length, 1);
  assert.equal(res.body.planets[0].starId, 1000000);
  assert.equal(res.body.planets[0].position.x, null, 'orbit-based planets carry no absolute position');
  assert.ok(res.body.planets[0].orbit, 'orbit params are present so the client can place it');
});

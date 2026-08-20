import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import searchHandler from '../api/search.js';

// Search exposes ONLY name + birth date + star-system id, queries the name_key
// prefix index on VISIBLE rows, and never touches the DB for an empty query.
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
  return { statusCode: null, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, setHeader(k, v) { this.headers[k] = v; } };
}

test('search returns only name/createdAt/starId and queries visible name_key prefix', async () => {
  supaEnv();
  let queried = '';
  globalThis.fetch = async (url) => {
    queried = String(url);
    return { ok: true, status: 200, text: async () => JSON.stringify([{ name: 'Pinku', created_at: '2026-08-20T00:00:00Z', star_id: 3 }]) };
  };
  const res = mockRes();
  await searchHandler({ method: 'GET', query: { q: 'Pin' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.results.length, 1);
  assert.deepEqual(Object.keys(res.body.results[0]).sort(), ['createdAt', 'name', 'starId']);
  // exactly these columns are selected — no ids, artwork, ip, report counts
  assert.match(queried, /select=name,created_at,star_id/);
  assert.match(queried, /status=eq\.visible/);
  assert.match(queried, /name_key=like\.pin\*/);
});

test('search normalizes the query (case-insensitive, trimmed)', async () => {
  supaEnv();
  let queried = '';
  globalThis.fetch = async (url) => { queried = String(url); return { ok: true, status: 200, text: async () => '[]' }; };
  await searchHandler({ method: 'GET', query: { q: '  PINKU  ' } }, mockRes());
  assert.match(queried, /name_key=like\.pinku\*/);
});

test('empty query returns [] and never hits the database', async () => {
  supaEnv();
  let called = false;
  globalThis.fetch = async () => { called = true; return { ok: true, status: 200, text: async () => '[]' }; };
  const res = mockRes();
  await searchHandler({ method: 'GET', query: { q: '   ' } }, res);
  assert.deepEqual(res.body, { results: [] });
  assert.equal(called, false);
});

test('a nonexistent name yields empty results', async () => {
  supaEnv();
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => '[]' });
  const res = mockRes();
  await searchHandler({ method: 'GET', query: { q: 'zzzznope' } }, res);
  assert.deepEqual(res.body.results, []);
});

// Report store. The entire moderation rule lives here:
//
//   three DIFFERENT IP addresses report a planet -> the planet is HIDDEN.
//
// - one report per IP per planet (a repeat is a silent no-op)
// - distinct IPs are counted, never raw report rows
// - hiding sets a flag; nothing is ever deleted
//
// Atomicity: JavaScript is single-threaded, so addReport's read-check-write
// runs to completion before any other request's does within an instance --
// three near-simultaneous unique IPs reliably produce hidden at exactly the
// third, never the second or fourth.
//
// Honest limitation: this store is in-memory, per serverless instance.
// Reports landing on different instances are counted separately until a
// durable store exists. When one is added (e.g. Postgres/Supabase), the
// equivalent is a (planet_key, reporter_ip) unique constraint plus a
// count(distinct reporter_ip) >= threshold transition -- the interface
// below stays the same.

const THRESHOLD = (() => {
  const v = parseInt(process.env.REPORT_THRESHOLD, 10);
  return Number.isFinite(v) && v > 0 ? v : 3;
})();

const planets = new Map(); // key -> { ips: Set<string>, hiddenAt: number|null, reports: [{ipHash, at}] }

import { createHash } from 'node:crypto';

// IPs are stored hashed -- enough to count distinct sources, no need to
// keep raw addresses around
function ipHash(ip) {
  return createHash('sha256').update('planet-report:').update(ip).digest('hex').slice(0, 24);
}

export function addReport(key, ip, now = Date.now()) {
  let p = planets.get(key);
  if (!p) {
    p = { ips: new Set(), hiddenAt: null, reports: [] };
    planets.set(key, p);
  }
  const h = ipHash(ip);
  if (p.ips.has(h)) {
    return { added: false, hidden: p.hiddenAt !== null };
  }
  p.ips.add(h);
  p.reports.push({ ipHash: h, at: now });
  if (p.hiddenAt === null && p.ips.size >= THRESHOLD) {
    p.hiddenAt = now;
  }
  return { added: true, hidden: p.hiddenAt !== null };
}

export function isHidden(key) {
  const p = planets.get(key);
  return !!(p && p.hiddenAt !== null);
}

export function listHidden() {
  const out = [];
  for (const [key, p] of planets) {
    if (p.hiddenAt !== null) out.push(key);
  }
  return out;
}

// data survives hiding -- for tests and any future review tooling
export function _peek(key) {
  return planets.get(key) || null;
}

export function _resetForTests() {
  planets.clear();
}

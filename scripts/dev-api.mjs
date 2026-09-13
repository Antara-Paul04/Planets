#!/usr/bin/env node
// A stand-in for the /api functions so `npm run dev` works with no Supabase
// and no `vercel dev`: an in-memory universe persisted to .dev-universe/ (git-
// ignored) so planets survive a restart. Same routes, same response shapes,
// same validation modules as the real handlers -- but no capacity locking, no
// IP hashing, and (by default) no daily limit, so you can make as many test
// planets as you like. Set DEV_LIMIT=1 to feel the one-a-day rule.
//
//   npm run dev:api     # :3000, which vite.config.js already proxies /api to
//   npm run dev         # :5173

import http from 'node:http';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { decodeArtwork } from '../lib/validate-image.js';
import { normalizeNameKey } from '../lib/name.js';
import { sanitizeSong, sanitizeMessage, nameFromSlug } from '../lib/song.js';
import { capacityForType } from '../lib/capacity.js';
import { fetchSongTitle } from '../lib/song-meta.js';
import { renderCard } from '../lib/og-card.js';

const PORT = Number(process.env.PORT || 3000);
const DIR = join(process.cwd(), '.dev-universe');
const STATE = join(DIR, 'state.json');
const LIMIT = process.env.DEV_LIMIT === '1';
mkdirSync(join(DIR, 'art'), { recursive: true });

const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { planets: [], stars: {}, reports: {} };
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 1));

const json = (res, status, body, extra = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra });
  res.end(JSON.stringify(body));
};
const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;
  req.on('data', (c) => { size += c.length; if (size > 2 * 1024 * 1024) { reject(new Error('too large')); req.destroy(); } chunks.push(c); });
  req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(e); } });
  req.on('error', reject);
});
const today = () => new Date().toISOString().slice(0, 10);

const publicPlanet = (p) => ({
  id: p.id, name: p.name, createdAt: p.createdAt,
  artworkUrl: `/api/dev-art/${p.artworkFile}`,
  starId: p.starId,
  position: { x: null, y: null, z: null },
  orbit: p.orbit,
  satelliteType: p.satelliteType, satelliteConfig: p.satelliteConfig,
  surfaceType: p.surfaceType, vibe: p.vibe, scale: p.scale, rotationSpeed: p.rotationSpeed, tilt: p.tilt,
  song: p.song, message: p.message,
});

async function createPlanet(b, ip) {
  const name = typeof b.name === 'string' ? b.name.trim().slice(0, 64) : '';
  if (!name) return [400, { error: 'invalid_name' }];
  const art = decodeArtwork(b.image);
  if (!art.ok) return [400, { error: 'invalid_artwork', detail: art.error }];
  const cands = Array.isArray(b.candidates) ? b.candidates : [];
  if (!cands.length) return [400, { error: 'no_candidate_stars' }];

  const existing = state.planets.find((p) => p.clientRef === b.clientRef);
  if (existing) return [200, { ok: true, planet: assignment(existing, true) }];
  if (LIMIT && state.planets.some((p) => p.creator === ip && p.day === today())) return [409, { error: 'planet_limit_reached' }];
  const key = normalizeNameKey(name);
  if (state.planets.some((p) => p.nameKey === key)) return [409, { error: 'name_taken' }];

  // capacity, nearest-first, no locking (single process)
  let cand = cands.find((c) => state.planets.filter((p) => p.starId === c.id).length < capacityForType(c.type)) || cands[0];
  const star = state.stars[cand.id] || (state.stars[cand.id] = {
    id: cand.id, type: cand.type, seed: cand.seed, radius: cand.radius,
    x: cand.x, y: cand.y, z: cand.z, plane_incl: cand.plane_incl, plane_node: cand.plane_node,
  });
  const extent = Math.min(200, Math.max(1, Number(b.extent) || 3));
  const mine = state.planets.filter((p) => p.starId === star.id);
  const maxr = mine.length ? Math.max(...mine.map((p) => p.orbit.radius + (p.extent || 3))) : null;
  const r = maxr == null ? star.radius * 1.9 + 10 + extent + Math.random() * 5 : maxr + extent + 6 + Math.random() * 9;
  const dir = Math.random() < 0.12 ? -1 : 1;
  const orbit = {
    radius: r, angle: Math.random() * Math.PI * 2, speed: (2.6 / Math.pow(r, 0.85)) * dir,
    incl: star.plane_incl + (Math.random() - 0.5) * 0.24, node: star.plane_node + (Math.random() - 0.5) * 0.3,
  };
  const artworkFile = `${b.clientRef}.${art.ext}`;
  writeFileSync(join(DIR, 'art', artworkFile), art.buffer);
  const song = sanitizeSong(b.song);
  if (song) song.title = await fetchSongTitle(song);
  const planet = {
    id: randomUUID(), clientRef: b.clientRef, name, nameKey: key, createdAt: new Date().toISOString(), day: today(), creator: ip,
    starId: star.id, orbit, extent, artworkFile,
    satelliteType: ['none', 'moons', 'rings'].includes(b.satelliteType) ? b.satelliteType : 'none',
    satelliteConfig: b.satelliteConfig && typeof b.satelliteConfig === 'object' ? b.satelliteConfig : null,
    surfaceType: typeof b.surfaceType === 'string' ? b.surfaceType.slice(0, 16) : null,
    vibe: typeof b.vibe === 'string' ? b.vibe.slice(0, 16) : null,
    scale: Number(b.scale) || 2.4, rotationSpeed: Number(b.rotationSpeed) || 0.12, tilt: Number(b.tilt) || 0.25,
    song, message: sanitizeMessage(b.message), hidden: false,
  };
  state.planets.push(planet);
  save();
  console.log(`+ planet "${name}" @ star ${star.id}${song ? ` ♪ ${song.title || song.id} (${song.provider} @${song.start}s)` : ''}${planet.message ? ` “${planet.message}”` : ''}`);
  return [200, { ok: true, planet: assignment(planet, false) }];
}

function assignment(p, dedup) {
  const s = state.stars[p.starId];
  return {
    id: p.id, createdAt: p.createdAt, artworkUrl: `/api/dev-art/${p.artworkFile}`,
    star: { ...s, isNew: false }, orbit: p.orbit, deduplicated: dedup,
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const ip = req.socket.remoteAddress || 'dev';
  try {
    if (url.pathname === '/api/planets' && req.method === 'GET') {
      return json(res, 200, { planets: state.planets.filter((p) => !p.hidden).map(publicPlanet), stars: [] });
    }
    if (url.pathname === '/api/create-planet' && req.method === 'POST') {
      const [status, body] = await createPlanet(await readBody(req), ip);
      return json(res, status, body);
    }
    if (url.pathname === '/api/search' && req.method === 'GET') {
      const q = normalizeNameKey(url.searchParams.get('q') || '');
      if (!q) return json(res, 200, { results: [] });
      const results = state.planets.filter((p) => !p.hidden && p.nameKey.startsWith(q)).slice(0, 8)
        .map((p) => ({ name: p.name, createdAt: p.createdAt, starId: p.starId }));
      return json(res, 200, { results });
    }
    if (url.pathname === '/api/planet' && req.method === 'GET') {
      const raw = url.searchParams.get('name') || '';
      const keys = [normalizeNameKey(raw), normalizeNameKey(nameFromSlug(raw))];
      const p = state.planets.find((x) => !x.hidden && keys.includes(x.nameKey));
      if (!p) return json(res, 404, { error: 'not_found' });
      const { id, name, createdAt, starId, artworkUrl, song, message } = publicPlanet(p);
      return json(res, 200, { planet: { id, name, createdAt, starId, artworkUrl, song, message } });
    }
    if (url.pathname === '/api/og' && req.method === 'GET') {
      const raw = url.searchParams.get('name') || '';
      const keys = [normalizeNameKey(raw), normalizeNameKey(nameFromSlug(raw))];
      const p = state.planets.find((x) => !x.hidden && keys.includes(x.nameKey));
      const planet = p ? { ...publicPlanet(p), artworkUrl: `http://localhost:${PORT}/api/dev-art/${p.artworkFile}` } : null;
      const png = await renderCard(planet, { origin: 'http://localhost:5173' });
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
      return res.end(png);
    }
    if (url.pathname === '/api/report' && req.method === 'POST') {
      const { planetId } = await readBody(req);
      const p = state.planets.find((x) => x.id === planetId);
      if (!p) return json(res, 404, { ok: false, error: 'not_found' });
      const set = new Set(state.reports[planetId] || []);
      set.add(ip);
      state.reports[planetId] = [...set];
      if (set.size >= 3) p.hidden = true;
      save();
      return json(res, 200, { ok: true, hidden: !!p.hidden });
    }
    if (url.pathname.startsWith('/api/dev-art/') && req.method === 'GET') {
      const file = url.pathname.slice('/api/dev-art/'.length).replace(/[^A-Za-z0-9._-]/g, '');
      const path = join(DIR, 'art', file);
      if (!existsSync(path)) { res.writeHead(404); return res.end(); }
      const type = file.endsWith('.webp') ? 'image/webp' : file.endsWith('.jpg') ? 'image/jpeg' : 'image/png';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
      return res.end(readFileSync(path));
    }
    json(res, 404, { error: 'not_found' });
  } catch (e) {
    json(res, 500, { error: 'dev_api_error', detail: String(e && e.message) });
  }
});

server.listen(PORT, () => {
  console.log(`dev universe on http://localhost:${PORT}  (${state.planets.length} planets, limit ${LIMIT ? 'on' : 'off'})`);
});

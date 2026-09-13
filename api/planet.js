import { getSupabase, isProductionStrict } from '../lib/db/supabase.js';
import { normalizeNameKey } from '../lib/name.js';
import { nameFromSlug } from '../lib/song.js';

// GET /api/planet?name=<name or slug>
// The exact lookup behind /p/<name>: ONE visible planet by normalized name.
// A slug ("pinku-blobu") is tried as-is first (names may contain hyphens),
// then with hyphens read as spaces. Returns the public shape only: name,
// birth date, star, artwork, song, message. 404 when there is no such world.

export function shapePlanet(db, p) {
  return {
    id: p.id,
    name: p.name,
    createdAt: p.created_at,
    starId: p.star_id,
    artworkUrl: p.artwork_path ? db.publicArtworkUrl(p.artwork_path) : null,
    song: p.song_provider && p.song_id
      ? { provider: p.song_provider, id: p.song_id, start: p.song_start || 0, title: p.song_title || null }
      : null,
    message: p.message || null,
  };
}

// both readings of a slug, deduplicated, in the order we try them
export function nameKeyCandidates(raw) {
  const s = Array.isArray(raw) ? raw[0] : raw;
  const out = [];
  for (const k of [normalizeNameKey(s), normalizeNameKey(nameFromSlug(s))]) {
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'method_not_allowed' }); return; }
  const keys = nameKeyCandidates(req.query ? req.query.name : '');
  if (!keys.length) { res.status(400).json({ error: 'invalid_name' }); return; }

  const db = getSupabase();
  if (!db) {
    res.status(isProductionStrict() ? 503 : 404).json({ error: isProductionStrict() ? 'universe_unavailable' : 'not_found', fallback: !isProductionStrict() });
    return;
  }
  try {
    for (const key of keys) {
      const out = await db.findVisiblePlanetByNameKey(key);
      if (out.ok && Array.isArray(out.json) && out.json[0]) {
        res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
        res.status(200).json({ planet: shapePlanet(db, out.json[0]) });
        return;
      }
    }
    res.status(404).json({ error: 'not_found' });
  } catch {
    res.status(isProductionStrict() ? 503 : 404).json({ error: isProductionStrict() ? 'universe_unavailable' : 'not_found' });
  }
}

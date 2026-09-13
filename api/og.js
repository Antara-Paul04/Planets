import { getSupabase } from '../lib/db/supabase.js';
import { shapePlanet, nameKeyCandidates } from './planet.js';
import { renderCard, OG_WIDTH, OG_HEIGHT } from '../lib/og-card.js';

// GET /api/og?name=<name or slug>
// The planet's unfurl card as a 1200x630 PNG (see lib/og-card.js). Referenced
// by the og:image tag that api/p.js injects, so crawlers fetch it; visitors
// never do. An unknown planet still gets a generic ASTRAY card, so a link to
// a world that has drifted away never previews as a broken image.

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'method_not_allowed' }); return; }
  const raw = req.query ? (req.query.name ?? req.query.slug ?? '') : '';
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const origin = `${proto}://${req.headers['x-forwarded-host'] || req.headers.host || 'go-astray.vercel.app'}`;

  let planet = null;
  const db = getSupabase();
  if (db) {
    try {
      for (const key of nameKeyCandidates(raw)) {
        const out = await db.findVisiblePlanetByNameKey(key);
        if (out.ok && Array.isArray(out.json) && out.json[0]) { planet = shapePlanet(db, out.json[0]); break; }
      }
    } catch { /* generic card */ }
  }

  try {
    const png = await renderCard(planet, { origin });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Length', String(png.length));
    res.setHeader('X-OG-Size', `${OG_WIDTH}x${OG_HEIGHT}`);
    res.setHeader('Cache-Control', planet ? 's-maxage=86400, stale-while-revalidate=604800' : 's-maxage=300');
    res.status(200).send(png);
  } catch {
    res.status(500).json({ error: 'card_failed' });
  }
}

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getSupabase } from '../lib/db/supabase.js';
import { shapePlanet, nameKeyCandidates } from './planet.js';
import { songUrl } from '../lib/song.js';

// GET /p/<slug>  (rewritten here by vercel.json)
//
// A planet's own address. Humans get the normal app, which reads the path and
// flies them to the planet on arrival (src/main.js). Link unfurlers -- iMessage,
// WhatsApp, Instagram, X, Slack -- don't run JavaScript, so this function serves
// the built index.html with the planet's Open Graph tags injected into <head>:
// its name as the title, its message as the description, its artwork as the
// image. When the built HTML can't be read (local `vercel dev` before a build)
// a tiny shell with the same tags redirects to the app instead.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function ogTags({ url, title, description, image }) {
  const sized = !!image && /\/api\/og\?/.test(image);
  return [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="ASTRAY">`,
    `<meta property="og:url" content="${esc(url)}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    image ? `<meta property="og:image" content="${esc(image)}">` : '',
    sized ? `<meta property="og:image:width" content="1200">` : '',
    sized ? `<meta property="og:image:height" content="630">` : '',
    sized ? `<meta property="og:image:type" content="image/png">` : '',
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(description)}">`,
    image ? `<meta name="twitter:image" content="${esc(image)}">` : '',
  ].filter(Boolean).join('\n    ');
}

export function describe(planet, slug, origin) {
  const url = `${origin}/p/${slug}`;
  // the card is rendered by api/og.js; unknown planets still get a generic one
  const image = `${origin}/api/og?name=${slug}`;
  if (!planet) {
    return { url, title: 'a planet in ASTRAY', description: 'someone made a planet. tap to fly there.', image };
  }
  const title = `${planet.name} · a planet in ASTRAY`;
  const hear = planet.song ? (planet.song.title ? ` and hear “${planet.song.title}”` : ' and hear its song') : '';
  const description = planet.message
    ? `“${planet.message}” — tap to fly there${hear}.`
    : `a planet someone made. tap to fly there${hear}.`;
  return { url, title, description, image, song: songUrl(planet.song) };
}

let cachedShell = null;
function appShell() {
  if (cachedShell !== null) return cachedShell;
  for (const p of [join(process.cwd(), 'dist', 'index.html'), join(process.cwd(), 'index.html')]) {
    try { cachedShell = readFileSync(p, 'utf8'); return cachedShell; } catch { /* next */ }
  }
  cachedShell = '';
  return cachedShell;
}

// drop the base tags index.html ships with so the planet's own win
function stripBaseMeta(html) {
  return html
    .replace(/<title>[^<]*<\/title>\s*/i, '')
    .replace(/<meta (?:name|property)="(?:description|og:[a-z_:]+|twitter:[a-z_:]+)"[^>]*>\s*/gi, '');
}

export function renderPage(shell, tags, slug) {
  if (shell && /<\/head>/i.test(shell)) {
    return stripBaseMeta(shell).replace(/<\/head>/i, `    ${tags}\n  </head>`);
  }
  // no built app on disk: a shell that unfurls correctly and sends humans on
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
    ${tags}
    <meta http-equiv="refresh" content="0;url=/?p=${esc(slug)}"></head>
    <body style="background:#0a0d1c"></body></html>`;
}

export default async function handler(req, res) {
  const raw = req.query ? (req.query.slug ?? req.query.name ?? '') : '';
  const slug = encodeURIComponent(String(Array.isArray(raw) ? raw[0] : raw).slice(0, 80));
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
    } catch { /* unfurl generically */ }
  }

  const tags = ogTags(describe(planet, slug, origin));
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=600');
  res.status(200).send(renderPage(appShell(), tags, slug));
}

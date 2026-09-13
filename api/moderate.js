import { getSupabase } from '../lib/db/supabase.js';
import { verifyModerationSig, MOD_ACTIONS } from '../lib/reports/notify.js';

// GET /api/moderate?planet=<id>&action=hide|unhide&sig=<hmac>
//
// The project owner's one-click action, reached from a report notification.
// No login, no session: the link itself is the credential -- an HMAC over
// (action, planet id) with MODERATION_SECRET, so a link can only ever do the
// one thing to the one planet it was minted for, and a guessed link does
// nothing. Hidden planets keep their row and files (nothing is deleted);
// `unhide` restores one the rule or a click took down by mistake.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function page(res, status, title, body) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0d1c;color:#e6e8ec;font:15px/1.5 "IBM Plex Mono",ui-monospace,Menlo,monospace}main{max-width:440px;padding:32px;text-align:center}h1{font:600 22px/1.2 "IBM Plex Sans Condensed",sans-serif;letter-spacing:.12em;text-transform:uppercase;margin:0 0 12px}p{margin:8px 0;color:rgba(230,232,236,.7)}a{color:#ff7a2f}</style></head>
<body><main><h1>${esc(title)}</h1>${body}</main></body></html>`);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'method_not_allowed' }); return; }
  const q = req.query || {};
  const planetId = typeof q.planet === 'string' ? q.planet : '';
  const action = typeof q.action === 'string' ? q.action : '';
  const sig = typeof q.sig === 'string' ? q.sig : '';

  if (!UUID_RE.test(planetId) || !MOD_ACTIONS.includes(action) || !verifyModerationSig(planetId, action, sig)) {
    page(res, 403, 'not a valid link', '<p>this moderation link is not valid for that planet.</p>');
    return;
  }
  const db = getSupabase();
  if (!db) { page(res, 503, 'universe unavailable', '<p>the database is not configured here.</p>'); return; }

  const found = await db.findPlanetById(planetId);
  const planet = found.ok && Array.isArray(found.json) ? found.json[0] : null;
  if (!planet) { page(res, 404, 'no such planet', '<p>it may already be gone.</p>'); return; }

  const status = action === 'hide' ? 'hidden' : 'visible';
  const out = await db.setPlanetStatus(planetId, status);
  if (!out.ok) { page(res, 500, 'that did not work', '<p>the database refused the change. try again in a moment.</p>'); return; }

  console.log(JSON.stringify({ at: 'moderate', ts: new Date().toISOString(), id: planetId, status }));
  page(res, 200, status === 'hidden' ? 'hidden' : 'restored',
    `<p>“${esc(planet.name)}” is now <strong>${status}</strong>.</p>
     <p>${status === 'hidden' ? 'it keeps its row and files; nothing was deleted.' : 'it is back in the universe.'}</p>`);
}

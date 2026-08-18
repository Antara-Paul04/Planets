// Browser side of moderation: flatten the ORIGINAL rectangular artwork to a
// reasonable size, send it to our own API (never to providers directly), and
// normalize the answer. No keys live here.
//
// Modes (VITE_MODERATION):
//   'auto' (default) - call the API; if it is unreachable, approve in local
//                      dev but FAIL CLOSED to "review" in production builds
//   'required'       - always call; unreachable means "review"
//   'off'            - skip moderation entirely (local prototyping)

const RAW_MODE = import.meta.env.VITE_MODERATION || 'auto';
// 'off' is a local-prototyping convenience only; production builds ignore it
const MODE = RAW_MODE === 'off' && !import.meta.env.DEV ? 'auto' : RAW_MODE;
if (RAW_MODE !== MODE) console.warn('[moderation] VITE_MODERATION=off is ignored in production builds');

function flatten(canvas, w = 512, h = 256) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1a1e30'; // transparency flattened onto the canvas base
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(canvas, 0, 0, w, h);
  return c.toDataURL('image/png');
}

export async function submitForModeration({ canvas, name }) {
  if (MODE === 'off') return { decision: 'approved', bypassed: true };

  let image;
  try {
    image = flatten(canvas);
  } catch {
    return { decision: 'review', offline: true };
  }

  try {
    const res = await fetch('/api/moderate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image, name }),
    });
    if (res.status === 429) return { decision: 'review', rateLimited: true };
    if (!res.ok) throw new Error(`http_${res.status}`);
    const json = await res.json();
    if (json && ['approved', 'review', 'rejected'].includes(json.decision)) {
      return { decision: json.decision };
    }
    throw new Error('malformed');
  } catch {
    if (MODE === 'auto' && import.meta.env.DEV) {
      console.warn('[moderation] endpoint unreachable in dev — allowing locally');
      return { decision: 'approved', bypassed: true };
    }
    return { decision: 'review', offline: true };
  }
}

export async function reportPlanet({ name, solarSystemId, canvas }) {
  const body = { name, solarSystemId };
  if (canvas) {
    try {
      body.image = flatten(canvas);
    } catch { /* report goes through without artwork */ }
  }
  try {
    await fetch('/api/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch { /* quiet — reporting must never error at the user */ }
}

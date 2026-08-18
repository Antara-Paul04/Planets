// Strict payload validation: data-URL PNG/JPEG only, size-capped, magic-byte
// checked. External URLs are never accepted -- this endpoint moderates the
// user's own canvas, not arbitrary internet content, and must not become an
// open proxy to the providers.

const MAGIC = {
  png: [0x89, 0x50, 0x4e, 0x47],
  jpeg: [0xff, 0xd8, 0xff],
};

export function validateSubmission(body, cfg) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'bad_body' };

  const name = typeof body.name === 'string' ? body.name.slice(0, cfg.maxNameLength) : '';

  const image = body.image;
  if (typeof image !== 'string') return { ok: false, error: 'missing_image' };
  const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(image);
  if (!m) return { ok: false, error: 'not_a_data_url' };

  const base64 = m[2];
  const approxBytes = Math.floor(base64.length * 0.75);
  if (approxBytes > cfg.maxImageBytes) return { ok: false, error: 'too_large' };
  if (approxBytes < 64) return { ok: false, error: 'too_small' };

  let buf;
  try {
    buf = Buffer.from(base64, 'base64');
  } catch {
    return { ok: false, error: 'bad_base64' };
  }
  const magic = MAGIC[m[1] === 'png' ? 'png' : 'jpeg'];
  for (let i = 0; i < magic.length; i++) {
    if (buf[i] !== magic[i]) return { ok: false, error: 'magic_mismatch' };
  }

  return { ok: true, name, image, bytes: buf.length };
}

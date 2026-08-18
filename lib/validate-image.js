// Artwork payload validation: data-URL PNG only, size-capped, magic-byte
// checked. External URLs are never accepted.

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
export const MAX_ARTWORK_BYTES = 300 * 1024; // free-plan friendly: ~300KB cap

export function decodeArtwork(image) {
  if (typeof image !== 'string') return { ok: false, error: 'missing_image' };
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(image);
  if (!m) return { ok: false, error: 'not_a_png_data_url' };
  const approx = Math.floor(m[1].length * 0.75);
  if (approx > MAX_ARTWORK_BYTES) return { ok: false, error: 'too_large' };
  if (approx < 64) return { ok: false, error: 'too_small' };
  let buf;
  try {
    buf = Buffer.from(m[1], 'base64');
  } catch {
    return { ok: false, error: 'bad_base64' };
  }
  for (let i = 0; i < PNG_MAGIC.length; i++) {
    if (buf[i] !== PNG_MAGIC[i]) return { ok: false, error: 'magic_mismatch' };
  }
  return { ok: true, buffer: buf };
}

// Artwork payload validation: a data-URL raster (PNG, WebP, or JPEG), size-capped
// and magic-byte checked. External URLs are never accepted. Compressed formats
// (WebP/JPEG) are accepted so the client can upload a small, storage-friendly
// image; PNG remains valid for older browsers that can't encode WebP/JPEG.

export const MAX_ARTWORK_BYTES = 300 * 1024; // free-plan friendly: ~300KB cap

// magic bytes + canonical extension per accepted type
const TYPES = {
  'image/png': { ext: 'png', magic: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  'image/jpeg': { ext: 'jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  // RIFF....WEBP
  'image/webp': { ext: 'webp', magic: (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 },
};

export function decodeArtwork(image) {
  if (typeof image !== 'string') return { ok: false, error: 'missing_image' };
  const m = /^data:(image\/(?:png|webp|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(image);
  if (!m) return { ok: false, error: 'not_a_raster_data_url' };
  const contentType = m[1];
  const spec = TYPES[contentType];
  const approx = Math.floor(m[2].length * 0.75);
  if (approx > MAX_ARTWORK_BYTES) return { ok: false, error: 'too_large' };
  if (approx < 64) return { ok: false, error: 'too_small' };
  let buf;
  try {
    buf = Buffer.from(m[2], 'base64');
  } catch {
    return { ok: false, error: 'bad_base64' };
  }
  if (!spec.magic(buf)) return { ok: false, error: 'magic_mismatch' };
  return { ok: true, buffer: buf, contentType, ext: spec.ext };
}

// Voice-line payload validation: a data-URL audio blob as browsers record it
// (WebM/Opus on Chrome and Firefox, MP4/AAC on Safari, Ogg/Opus elsewhere),
// size-capped and magic-byte checked. External URLs are never accepted.
// Duration is capped by the client at ten seconds; the server can't decode
// audio, so the byte cap is the hard ceiling here.

export const MAX_VOICE_BYTES = 400 * 1024; // ~10s of AAC at Safari's default, with room

const TYPES = {
  'audio/webm': { ext: 'webm', magic: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 },
  'video/webm': { ext: 'webm', magic: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 },
  'audio/ogg': { ext: 'ogg', magic: (b) => b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53 },
  // ....ftyp
  'audio/mp4': { ext: 'mp4', magic: (b) => b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 },
  'audio/x-m4a': { ext: 'm4a', magic: (b) => b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 },
  'audio/aac': { ext: 'mp4', magic: (b) => b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 },
};

export function decodeVoice(voice) {
  if (voice == null) return { ok: true, empty: true };
  if (typeof voice !== 'string') return { ok: false, error: 'not_a_string' };
  const m = /^data:((?:audio|video)\/[a-z0-9.+-]+)(?:;codecs=[^;,]+)?;base64,([A-Za-z0-9+/=]+)$/i.exec(voice);
  if (!m) return { ok: false, error: 'not_an_audio_data_url' };
  const contentType = m[1].toLowerCase();
  const spec = TYPES[contentType];
  if (!spec) return { ok: false, error: 'unsupported_type' };
  const approx = Math.floor(m[2].length * 0.75);
  if (approx > MAX_VOICE_BYTES) return { ok: false, error: 'too_large' };
  if (approx < 256) return { ok: false, error: 'too_small' };
  let buf;
  try { buf = Buffer.from(m[2], 'base64'); } catch { return { ok: false, error: 'bad_base64' }; }
  if (!spec.magic(buf)) return { ok: false, error: 'magic_mismatch' };
  const stored = contentType === 'video/webm' ? 'audio/webm' : contentType === 'audio/aac' ? 'audio/mp4' : contentType;
  return { ok: true, buffer: buf, contentType: stored, ext: spec.ext };
}

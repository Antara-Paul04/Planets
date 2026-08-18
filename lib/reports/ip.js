// Reporter IP extraction -- server-side only, never from the request body.
//
// Trust model (documented per deployment):
// - On Vercel, the platform terminates the connection and sets
//   x-forwarded-for itself; the FIRST entry is the real client address and
//   clients cannot strip or replace what the proxy appends in front of
//   their own headers. x-real-ip carries the same value.
// - Anything a client sends in the JSON body (e.g. {"ip": ...}) is ignored
//   by construction: this function only ever reads trusted proxy headers.
// - Behind a different proxy/CDN later, adjust this ONE function.

export function reporterIp(req) {
  const real = req.headers['x-real-ip'];
  if (typeof real === 'string' && real.trim()) return real.trim();
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) return fwd.split(',')[0].trim();
  return 'unknown';
}

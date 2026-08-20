import { createHmac } from 'node:crypto';

// IP addresses are never stored raw. A server-side keyed hash (HMAC) lets the
// database answer "has this IP already done X?" without keeping a plaintext IP
// table. The secret lives only in server env. Same salt resolution everywhere.
function ipSalt() {
  return process.env.REPORT_IP_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY || 'planets-dev-salt';
}

// Reporter identity: HMAC over the raw IP. Output is intentionally UNCHANGED
// from the original so existing reporter_ip_hash values stay consistent.
export function hashReporterIp(ip) {
  return createHmac('sha256', ipSalt()).update(String(ip)).digest('hex').slice(0, 32);
}

// Creator identity: the SAME HMAC mechanism, but domain-separated so the creator
// hash is a DIFFERENT value from the reporter hash for the same IP -- reporting
// and creation identities cannot be correlated. Used only for the
// one-planet-per-network creation limit.
export function hashCreatorIp(ip) {
  return createHmac('sha256', ipSalt()).update('create:' + String(ip)).digest('hex').slice(0, 32);
}

import { createHmac } from 'node:crypto';

// Reporter IPs are never stored raw. A server-side keyed hash (HMAC) lets
// the database answer "has this IP already reported this planet?" without
// keeping a plaintext IP table. The secret lives only in server env.

export function hashReporterIp(ip) {
  const salt = process.env.REPORT_IP_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY || 'planets-dev-salt';
  return createHmac('sha256', salt).update(String(ip)).digest('hex').slice(0, 32);
}

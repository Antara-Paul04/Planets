// Simple per-IP windows (minute + hour), in-memory per serverless instance.
// Not bulletproof against a distributed attacker, but it stops a single
// abuser from running up a provider bill. Configurable via env.

const buckets = new Map();

function take(entry, slot, capacity, windowMs, now) {
  let b = entry[slot];
  if (!b || now - b.start >= windowMs) {
    b = { start: now, used: 0 };
    entry[slot] = b;
  }
  if (b.used >= capacity) return false;
  b.used += 1;
  return true;
}

export function checkRateLimit(ip, cfg, now = Date.now()) {
  if (buckets.size > 5000) buckets.clear(); // crude memory guard
  let entry = buckets.get(ip);
  if (!entry) {
    entry = {};
    buckets.set(ip, entry);
  }
  const okMinute = take(entry, 'minute', cfg.ratePerMinute, 60000, now);
  const okHour = take(entry, 'hour', cfg.ratePerHour, 3600000, now);
  return okMinute && okHour;
}

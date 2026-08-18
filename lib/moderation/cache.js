import { createHash } from 'node:crypto';

// Identical artwork+name should not be re-moderated (and re-billed).
// Small LRU with TTL, keyed by content hash. Per serverless instance.

const entries = new Map();

export function submissionKey(image, name) {
  return createHash('sha256').update(image).update(' ').update(name).digest('hex');
}

export function cacheGet(key, cfg, now = Date.now()) {
  const e = entries.get(key);
  if (!e) return null;
  if (now - e.at > cfg.cacheTtlMs) {
    entries.delete(key);
    return null;
  }
  entries.delete(key);
  entries.set(key, e); // refresh LRU order
  return e.value;
}

export function cacheSet(key, value, cfg, now = Date.now()) {
  entries.set(key, { value, at: now });
  while (entries.size > cfg.cacheSize) {
    entries.delete(entries.keys().next().value);
  }
}

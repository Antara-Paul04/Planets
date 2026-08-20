// Normalized planet name used for BOTH uniqueness and search.
// Lower-cased, trimmed, internal whitespace collapsed to single spaces.
//
// This MUST stay in sync with the SQL that computes planets.name_key
// (migration 003): lower(regexp_replace(btrim(name), '\s+', ' ', 'g')).
export function normalizeNameKey(name) {
  return String(name == null ? '' : name)
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

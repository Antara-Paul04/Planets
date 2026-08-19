// Star capacity: how many USER planets a star can hold, derived
// deterministically from its type. This mirrors the star_capacity() SQL
// function in migration 002 — the database is authoritative, this copy exists
// for tests and any client-side reasoning. No randomness: the same star always
// has the same capacity.
//
// Ordered by the type's characteristic size (max radius in STAR_TYPES):
// blue/white are smallest, red is largest.

export const STAR_CAPACITY = {
  blue: 4,
  white: 6,
  orange: 9,
  yellow: 12,
  red: 15,
};

const DEFAULT_CAPACITY = 6;

export function capacityForType(type) {
  return Object.prototype.hasOwnProperty.call(STAR_CAPACITY, type)
    ? STAR_CAPACITY[type]
    : DEFAULT_CAPACITY;
}

// The id range reserved for dynamically-minted stars (created only when every
// existing star is full). Deterministic stars use their small array index.
export const DYNAMIC_STAR_ID_BASE = 1_000_000;

export function isDynamicStarId(id) {
  return Number.isInteger(id) && id >= DYNAMIC_STAR_ID_BASE;
}

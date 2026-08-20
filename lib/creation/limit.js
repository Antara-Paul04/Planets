// In-memory model of the creator-limit + idempotency ordering that
// assign_planet() enforces in the database (migration 004). The real database
// is authoritative; this mirror exists so the ordering guarantees are
// unit-testable without a live Postgres -- exactly as lib/reports/store.js
// mirrors report_planet().
//
// The rule: one planet per creator identity (a keyed HMAC of the creator's IP;
// the raw IP is never handled here -- callers pass the already-hashed value).
//
// Ordering (MUST match the SQL, in this order):
//   1. client_ref idempotency  -> return the existing planet (never rejected)
//   2. creator-limit pre-check -> planetLimitReached, BEFORE any capacity/mint
//   3. name uniqueness
//   4. capacity: first candidate with a free slot, else mint a new star
//   5. insert -- the UNIQUE indexes are the final race backstop. A concurrent
//      writer may commit between the pre-checks and this insert; the conflict
//      is disambiguated exactly as the SQL's unique_violation handler does:
//        client_ref conflict -> return existing (idempotent)
//        creator  conflict   -> planetLimitReached
//        otherwise (name)    -> nameTaken
//   To make step 5 testable (a real Postgres race can't run under node:test),
//   attemptCreate accepts a `_beforeInsert({ inject })` hook that a test uses to
//   simulate another request committing in the window between step 2 and step 5.

import { normalizeNameKey } from '../name.js';

export function createUniverse({ capacityOf } = {}) {
  const byClientRef = new Map(); // client_ref -> planet   (idempotency)
  const byCreator = new Map();   // creator_ip_hash -> planet (the UNIQUE index)
  const byName = new Map();      // name_key -> planet
  const starCounts = new Map();  // star_id -> planet count (capacity)
  const planets = [];
  let mintedStars = 0;
  let nextMintedId = 1000000;

  const cap = typeof capacityOf === 'function' ? capacityOf : () => 3;

  // simulate a concurrent request that has already committed a row
  function inject({ clientRef = null, creatorHash = null, name = '' }) {
    const planet = { id: `inj${planets.length + 1}`, clientRef, creatorHash, name, nameKey: normalizeNameKey(name), injected: true };
    planets.push(planet);
    if (clientRef != null) byClientRef.set(clientRef, planet);
    if (creatorHash != null) byCreator.set(creatorHash, planet);
    byName.set(planet.nameKey, planet);
    return planet;
  }

  function attemptCreate({ clientRef, creatorHash = null, name, candidates = [], _beforeInsert } = {}) {
    // 1. idempotency FIRST -- a retried client_ref returns its planet unchanged
    if (clientRef != null && byClientRef.has(clientRef)) {
      return { deduplicated: true, planet: byClientRef.get(clientRef) };
    }
    // 2. one planet per network -- stop here, before any capacity/mint work
    if (creatorHash != null && byCreator.has(creatorHash)) {
      return { planetLimitReached: true };
    }
    // 3. name uniqueness
    const nameKey = normalizeNameKey(name);
    if (byName.has(nameKey)) return { nameTaken: true };

    // 4. capacity: first candidate with a free slot, else mint (id not yet
    //    committed -- a rejected attempt below advances no counter)
    let starId = null;
    let minted = false;
    for (const c of candidates) {
      if ((starCounts.get(c.id) || 0) < cap(c)) { starId = c.id; break; }
    }
    if (starId == null) { starId = nextMintedId; minted = true; }

    // (test hook) a concurrent request may commit in this window
    if (typeof _beforeInsert === 'function') _beforeInsert({ inject });

    // 5. insert with the unique indexes as the final backstop, disambiguated in
    //    the SAME precedence as the SQL exception handler: client_ref, then
    //    creator, then name. No state has changed yet, so a rejection here
    //    consumes no capacity and mints no star.
    if (clientRef != null && byClientRef.has(clientRef)) {
      return { deduplicated: true, planet: byClientRef.get(clientRef) };
    }
    if (creatorHash != null && byCreator.has(creatorHash)) {
      return { planetLimitReached: true };
    }
    if (byName.has(nameKey)) return { nameTaken: true };

    const planet = { id: `p${planets.length + 1}`, clientRef, creatorHash, name, nameKey, starId, minted };
    planets.push(planet);
    if (clientRef != null) byClientRef.set(clientRef, planet);
    if (creatorHash != null) byCreator.set(creatorHash, planet);
    byName.set(nameKey, planet);
    starCounts.set(starId, (starCounts.get(starId) || 0) + 1);
    if (minted) { mintedStars++; nextMintedId = starId + 1; }
    return { ok: true, planet, starMinted: minted };
  }

  return {
    attemptCreate,
    planetCount: () => planets.length,
    mintedStars: () => mintedStars,
    starCount: (id) => starCounts.get(id) || 0,
    creatorHasPlanet: (h) => byCreator.has(h),
  };
}

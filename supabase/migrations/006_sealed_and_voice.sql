-- Sealed planets and voice lines.
--
-- reveal_at: a planet made for someone can be sealed until a moment the maker
-- picks (a birthday at midnight). Until then the public queries return the
-- planet WITHOUT its message, song and voice -- enforced in api/planets.js and
-- api/planet.js (lib/reveal.js), never trusted to the client. The planet
-- itself (name, artwork, orbit) is visible all along; only what it carries
-- is sealed. Never later than 400 days out.
--
-- voice_path: an optional voice line, up to ten seconds, stored as a file in
-- the same public bucket as artwork (voices/<client_ref>.<ext>); the database
-- keeps only the path. The maker chooses to publish it; it rides the same
-- report path as everything else on the planet.
--
-- Both are written by api/create-planet right after assign_planet() returns
-- (a plain UPDATE keyed by the new planet id), so assign_planet is unchanged.

alter table planets add column if not exists reveal_at timestamptz;
alter table planets add column if not exists voice_path text
  check (voice_path is null or voice_path ~ '^voices/[0-9a-f-]{36}\.(webm|ogg|mp4|m4a)$');

create index if not exists planets_reveal_at_idx on planets(reveal_at) where reveal_at is not null;

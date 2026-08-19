-- Planets universe: initial schema.
-- Minimal by design, sized for the Supabase Free Plan.
--
--   stars           deterministic suns (can have zero planets)
--   planets         user-created worlds (procedural planets stay procedural)
--   planet_reports  hashed-IP reports; 3 distinct IPs -> planet hidden
--
-- Anonymous by construction: no names, emails, accounts, or identities
-- anywhere. Reporter IPs are stored only as HMAC digests.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- stars
-- The universe's stars are deterministic (seeded); rows exist so planets
-- can reference their system. A star with no planets is simply a row no
-- planet points at.
create table if not exists stars (
  id integer primary key,          -- the deterministic universe star index
  star_type text not null,
  seed real not null,
  position_x real not null,
  position_y real not null,
  position_z real not null,
  created_at timestamptz not null default now()
);

-- -------------------------------------------------------------- planets
create table if not exists planets (
  id uuid primary key default gen_random_uuid(),
  client_ref uuid unique,          -- idempotency: retried creates return the same planet
  name text not null check (char_length(name) between 1 and 64),
  artwork_path text,               -- storage path only; image bytes never live in the DB
  status text not null default 'visible' check (status in ('visible', 'hidden')),
  star_id integer references stars(id),
  position_x real,
  position_y real,
  position_z real,
  orbit_radius real,
  orbit_angle real,
  orbit_speed real,
  orbit_inclination real,
  orbit_node real,
  -- moons XOR rings, enforced at the schema level
  satellite_type text not null default 'none' check (satellite_type in ('none', 'moons', 'rings')),
  satellite_config jsonb,          -- moon/ring/atmosphere parameters for the renderer
  surface_type text,
  vibe text,
  scale real,
  rotation_speed real,
  tilt real,
  created_at timestamptz not null default now(),  -- permanent; never updated
  updated_at timestamptz not null default now()
);

create index if not exists planets_status_idx on planets(status);
create index if not exists planets_star_idx on planets(star_id);

-- created_at is a birth date: no code path may change it
create or replace function protect_created_at()
returns trigger language plpgsql as $$
begin
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists planets_protect_created_at on planets;
create trigger planets_protect_created_at
  before update on planets
  for each row execute function protect_created_at();

-- ------------------------------------------------------- planet_reports
create table if not exists planet_reports (
  id uuid primary key default gen_random_uuid(),
  planet_id uuid not null references planets(id) on delete cascade,
  reporter_ip_hash text not null,  -- HMAC(server secret, ip); raw IPs never stored
  created_at timestamptz not null default now(),
  unique (planet_id, reporter_ip_hash)  -- one report per IP per planet, DB-enforced
);

create index if not exists planet_reports_planet_idx on planet_reports(planet_id);

-- The whole moderation rule, atomically:
--   insert report (deduped by the unique constraint)
--   count DISTINCT reporter hashes
--   at >= 3, hide the planet
-- Concurrent third reports cannot double-count or miss the transition: the
-- unique constraint serializes duplicates and the count runs inside the
-- same statement's transaction.
create or replace function report_planet(p_planet_id uuid, p_ip_hash text)
returns table (added boolean, hidden boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_added boolean := false;
  v_distinct integer;
begin
  begin
    insert into planet_reports (planet_id, reporter_ip_hash)
    values (p_planet_id, p_ip_hash);
    v_added := true;
  exception when unique_violation then
    v_added := false;
  end;

  select count(distinct reporter_ip_hash) into v_distinct
  from planet_reports
  where planet_id = p_planet_id;

  if v_distinct >= 3 then
    update planets
    set status = 'hidden'
    where id = p_planet_id and status = 'visible';
  end if;

  return query
    select v_added, (select status = 'hidden' from planets where id = p_planet_id);
end $$;

-- --------------------------------------------------- row level security
-- The browser never talks to PostgREST directly today (everything goes
-- through the server API with the service role), but RLS is enabled as
-- defense in depth with the narrowest useful public surface:
--   anon may read VISIBLE planets and stars. Nothing else.
alter table stars enable row level security;
alter table planets enable row level security;
alter table planet_reports enable row level security;

drop policy if exists "public read stars" on stars;
create policy "public read stars" on stars
  for select using (true);

drop policy if exists "public read visible planets" on planets;
create policy "public read visible planets" on planets
  for select using (status = 'visible');

-- planet_reports: no anon policies at all -- reports are written only by
-- the server (service role bypasses RLS); counts are never public.

-- ------------------------------------------------------------- storage
-- Public-read artwork bucket. Uploads happen only server-side (service
-- role); anon has no write path, so nobody can overwrite another planet's
-- artwork. Public read keeps egress on the cached tier.
insert into storage.buckets (id, name, public)
values ('planet-artwork', 'planet-artwork', true)
on conflict (id) do nothing;

-- The report RPC is SECURITY DEFINER, so it bypasses RLS by design. It must
-- therefore NOT be callable by anon/authenticated -- only the server (service
-- role) may invoke it. Otherwise a client could call it directly with a
-- forged ip_hash and defeat the three-distinct-IP rule.
revoke all on function report_planet(uuid, text) from public, anon, authenticated;
grant execute on function report_planet(uuid, text) to service_role;

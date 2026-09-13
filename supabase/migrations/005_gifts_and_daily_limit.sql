-- Planets for someone: a song and a one-line message on a planet, plus the
-- creation limit relaxed from "one planet per network, forever" to "one per
-- network per day" so a person can make a planet for a friend and another for
-- another friend tomorrow.
--
-- Song: only the provider and bare id are stored, never the pasted URL. The
-- server validates the shape (lib/song.js sanitizeSong); the database rejects
-- anything else with a CHECK so a bad row can't be inserted by any path.

alter table planets add column if not exists song_provider text
  check (song_provider is null or song_provider in ('spotify', 'youtube'));
alter table planets add column if not exists song_id text
  check (song_id is null or song_id ~ '^[A-Za-z0-9_-]{11,22}$');
alter table planets add column if not exists song_start integer not null default 0
  check (song_start between 0 and 21600);
alter table planets add column if not exists message text
  check (message is null or char_length(message) between 1 and 80);
-- the song's title, fetched server-side once at creation (lib/song-meta.js)
alter table planets add column if not exists song_title text
  check (song_title is null or char_length(song_title) between 1 and 120);
-- a song needs both halves or neither
alter table planets drop constraint if exists planets_song_pair_chk;
alter table planets add constraint planets_song_pair_chk
  check ((song_provider is null) = (song_id is null));

-- one per network PER DAY: the day (UTC) a planet was created, stored so a
-- unique index can cover it. created_at is permanent, so this is too.
alter table planets add column if not exists creator_day date
  generated always as ((created_at at time zone 'utc')::date) stored;

drop index if exists planets_creator_ip_hash_uidx;
create unique index if not exists planets_creator_day_uidx
  on planets(creator_ip_hash, creator_day)
  where creator_ip_hash is not null;

-- assign_planet: same ordering as 004, two changes:
--   2. the creator pre-check is scoped to TODAY (UTC)
--   5. the insert carries song_provider/song_id/song_start/message, and the
--      unique_violation handler recognises the new index name
drop function if exists assign_planet(uuid, jsonb, real, jsonb, text);
create or replace function assign_planet(
  p_client_ref uuid,
  p_candidates jsonb,
  p_extent real,
  p_planet jsonb,
  p_creator_ip_hash text default null
) returns table (
  planet_id uuid, created_at timestamptz, deduplicated boolean,
  star_id integer, star_type text, star_seed real, star_radius real,
  star_x real, star_y real, star_z real, star_plane_incl real, star_plane_node real, star_is_new boolean,
  o_radius real, o_angle real, o_speed real, o_incl real, o_node real,
  name_taken boolean, planet_limit_reached boolean
)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_existing planets%rowtype;
  v_name_key text;
  v_constraint text;
  cand jsonb;
  v_star_id integer; v_type text; v_cap integer; v_cnt integer;
  v_seed real; v_srad real; v_incl real; v_node real; v_sx real; v_sy real; v_sz real;
  v_chosen boolean := false; v_is_new boolean := false;
  v_maxr real; v_or real; v_oa real; v_os real; v_oi real; v_on real; v_dir integer;
  v_pid uuid; v_created timestamptz; h text;
begin
  -- 1. idempotency: a retried client_ref returns the existing planet unchanged
  select * into v_existing from planets where client_ref = p_client_ref;
  if found then
    return query
      select v_existing.id, v_existing.created_at, true,
        v_existing.star_id, s.star_type, s.seed, s.radius, s.position_x, s.position_y, s.position_z,
        s.plane_incl, s.plane_node, false,
        v_existing.orbit_radius, v_existing.orbit_angle, v_existing.orbit_speed,
        v_existing.orbit_inclination, v_existing.orbit_node, false, false
      from stars s where s.id = v_existing.star_id;
    return;
  end if;

  -- 2. one planet per network per day (UTC)
  if p_creator_ip_hash is not null
     and exists (
       select 1 from planets
       where creator_ip_hash = p_creator_ip_hash
         and creator_day = (now() at time zone 'utc')::date
     ) then
    return query select
      null::uuid, null::timestamptz, false,
      null::integer, null::text, null::real, null::real,
      null::real, null::real, null::real, null::real, null::real, false,
      null::real, null::real, null::real, null::real, null::real,
      false, true;
    return;
  end if;

  -- 3. normalized name must be unique across the universe (fast path)
  v_name_key := lower(regexp_replace(btrim(p_planet->>'name'), '\s+', ' ', 'g'));
  if exists (select 1 from planets where name_key = v_name_key) then
    return query select
      null::uuid, null::timestamptz, false,
      null::integer, null::text, null::real, null::real,
      null::real, null::real, null::real, null::real, null::real, false,
      null::real, null::real, null::real, null::real, null::real,
      true, false;
    return;
  end if;

  -- 4. first candidate (nearest-first) with a free slot wins
  for cand in select * from jsonb_array_elements(p_candidates) loop
    v_star_id := (cand->>'id')::integer;
    v_type := coalesce(cand->>'type', 'yellow');
    perform pg_advisory_xact_lock(42, v_star_id);
    v_cap := star_capacity(v_type);
    select count(*) into v_cnt from planets where star_id = v_star_id;
    if v_cnt < v_cap then
      v_chosen := true;
      v_seed := coalesce((cand->>'seed')::real, 0);
      v_srad := coalesce((cand->>'radius')::real, 16);
      v_sx := coalesce((cand->>'x')::real, 0);
      v_sy := coalesce((cand->>'y')::real, 0);
      v_sz := coalesce((cand->>'z')::real, 0);
      v_incl := coalesce((cand->>'plane_incl')::real, 0);
      v_node := coalesce((cand->>'plane_node')::real, 0);
      exit;
    end if;
  end loop;

  if not v_chosen then
    v_is_new := true;
    select coalesce(max(id), 999999) + 1 into v_star_id from stars where id >= 1000000;
    perform pg_advisory_xact_lock(43, v_star_id);
    h := md5(v_star_id::text || 'planets-dynamic-star');
    v_type := (array['yellow','orange','red','white','blue'])[1 + (('x' || substr(h,1,2))::bit(8)::int % 5)];
    v_seed := _hash_unit(h, 3) * 100.0;
    v_srad := 12 + _hash_unit(h, 9) * 16;
    v_sx := cos(_hash_unit(h,15) * 2 * pi()) * cos((_hash_unit(h,21) - 0.5) * 0.7) * (22000 + _hash_unit(h,3) * 30000);
    v_sy := sin((_hash_unit(h,21) - 0.5) * 0.7) * (22000 + _hash_unit(h,3) * 30000);
    v_sz := sin(_hash_unit(h,15) * 2 * pi()) * cos((_hash_unit(h,21) - 0.5) * 0.7) * (22000 + _hash_unit(h,3) * 30000);
    v_incl := (_hash_unit(h,9) - 0.5) * 0.7;
    v_node := _hash_unit(h,21) * 2 * pi();
  end if;

  insert into stars (id, star_type, seed, radius, position_x, position_y, position_z, plane_incl, plane_node)
  values (v_star_id, v_type, v_seed, v_srad, v_sx, v_sy, v_sz, v_incl, v_node)
  on conflict (id) do update set
    radius     = coalesce(stars.radius, excluded.radius),
    plane_incl = coalesce(stars.plane_incl, excluded.plane_incl),
    plane_node = coalesce(stars.plane_node, excluded.plane_node);

  select max(orbit_radius + coalesce(orbit_extent, 3)) into v_maxr
  from planets where star_id = v_star_id;
  if v_maxr is null then
    v_or := v_srad * 1.9 + 10 + p_extent + random() * 5;
  else
    v_or := v_maxr + p_extent + 6 + random() * 9;
  end if;
  v_oa := random() * 2 * pi();
  v_dir := case when random() < 0.12 then -1 else 1 end;
  v_os := (2.6 / power(v_or, 0.85)) * v_dir;
  v_oi := v_incl + (random() - 0.5) * 0.24;
  v_on := v_node + (random() - 0.5) * 0.3;

  -- 5. insert; unique_violation disambiguated: retry -> existing, creator-day
  --    index -> planet_limit_reached, anything else -> name_taken
  begin
    insert into planets (
      client_ref, name, name_key, creator_ip_hash, status, star_id, artwork_path,
      orbit_radius, orbit_angle, orbit_speed, orbit_inclination, orbit_node, orbit_extent,
      satellite_type, satellite_config, surface_type, vibe, scale, rotation_speed, tilt,
      song_provider, song_id, song_start, song_title, message
    ) values (
      p_client_ref, p_planet->>'name', v_name_key, p_creator_ip_hash, 'visible', v_star_id, p_planet->>'artwork_path',
      v_or, v_oa, v_os, v_oi, v_on, p_extent,
      coalesce(p_planet->>'satellite_type', 'none'), (p_planet->'satellite_config'),
      p_planet->>'surface_type', p_planet->>'vibe',
      (p_planet->>'scale')::real, (p_planet->>'rotation_speed')::real, (p_planet->>'tilt')::real,
      p_planet->>'song_provider', p_planet->>'song_id',
      coalesce((p_planet->>'song_start')::integer, 0), p_planet->>'song_title', p_planet->>'message'
    ) returning id, created_at into v_pid, v_created;
  exception when unique_violation then
    select * into v_existing from planets where client_ref = p_client_ref;
    if found then
      return query
        select v_existing.id, v_existing.created_at, true,
          v_existing.star_id, s.star_type, s.seed, s.radius, s.position_x, s.position_y, s.position_z,
          s.plane_incl, s.plane_node, false,
          v_existing.orbit_radius, v_existing.orbit_angle, v_existing.orbit_speed,
          v_existing.orbit_inclination, v_existing.orbit_node, false, false
        from stars s where s.id = v_existing.star_id;
      return;
    end if;
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'planets_creator_day_uidx' then
      return query select
        null::uuid, null::timestamptz, false,
        null::integer, null::text, null::real, null::real,
        null::real, null::real, null::real, null::real, null::real, false,
        null::real, null::real, null::real, null::real, null::real,
        false, true;
      return;
    else
      return query select
        null::uuid, null::timestamptz, false,
        null::integer, null::text, null::real, null::real,
        null::real, null::real, null::real, null::real, null::real, false,
        null::real, null::real, null::real, null::real, null::real,
        true, false;
      return;
    end if;
  end;

  return query
    select v_pid, v_created, false,
      v_star_id, v_type, v_seed, v_srad, v_sx, v_sy, v_sz, v_incl, v_node, v_is_new,
      v_or, v_oa, v_os, v_oi, v_on, false, false;
end $$;

revoke all on function assign_planet(uuid, jsonb, real, jsonb, text) from public, anon, authenticated;
grant execute on function assign_planet(uuid, jsonb, real, jsonb, text) to service_role;

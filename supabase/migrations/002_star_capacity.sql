-- 002: star capacity + atomic slot assignment.
--
-- Every star supports a maximum number of USER planets, derived deterministically
-- from its type (no random, no per-star capacity storage). Assignment is
-- server-authoritative and atomic: the browser proposes candidate stars
-- (nearest-first) and the database decides the final home, counting persisted
-- planets and locking per-star so two simultaneous creators can't overflow a
-- system. When every candidate is full, a new star is minted deterministically.
--
-- Existing deterministic stars (ids 0..N, generated on the client) and existing
-- planets are never touched by this migration.

-- Columns dynamic stars need to persist (existing deterministic stars leave
-- these null and are regenerated on the client). orbit_extent lets the band
-- packer respect each planet's visual size.
alter table stars   add column if not exists radius real;
alter table stars   add column if not exists plane_incl real;
alter table stars   add column if not exists plane_node real;
alter table planets add column if not exists orbit_extent real;

-- Capacity: type -> max user planets. Ordered by the type's characteristic
-- size (max radius): blue/white smallest, red largest. Deterministic + stable.
create or replace function star_capacity(p_type text)
returns integer language sql immutable as $$
  select case p_type
    when 'blue'   then 4
    when 'white'  then 6
    when 'orange' then 9
    when 'yellow' then 12
    when 'red'    then 15
    else 6
  end
$$;

-- read 24 deterministic bits of an md5 hex string as a 0..1 fraction
create or replace function _hash_unit(h text, pos integer)
returns double precision language sql immutable as $$
  select (('x' || substr(h, pos, 6))::bit(24)::int) / 16777215.0
$$;

-- Atomically assign the new planet to a star and return the full placement.
-- p_candidates: ordered [{id,type,seed,x,y,z,radius,plane_incl,plane_node}, ...]
-- p_planet:     {name, satellite_type, satellite_config, surface_type, vibe,
--                scale, rotation_speed, tilt}
create or replace function assign_planet(
  p_client_ref uuid,
  p_candidates jsonb,
  p_extent real,
  p_planet jsonb
) returns table (
  planet_id uuid, created_at timestamptz, deduplicated boolean,
  star_id integer, star_type text, star_seed real, star_radius real,
  star_x real, star_y real, star_z real, star_plane_incl real, star_plane_node real, star_is_new boolean,
  o_radius real, o_angle real, o_speed real, o_incl real, o_node real
)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_existing planets%rowtype;
  cand jsonb;
  v_star_id integer; v_type text; v_cap integer; v_cnt integer;
  v_seed real; v_srad real; v_incl real; v_node real; v_sx real; v_sy real; v_sz real;
  v_chosen boolean := false; v_is_new boolean := false;
  v_maxr real; v_or real; v_oa real; v_os real; v_oi real; v_on real; v_dir integer;
  v_pid uuid; v_created timestamptz; h text;
begin
  -- idempotency: a retried client_ref returns the existing planet unchanged
  select * into v_existing from planets where client_ref = p_client_ref;
  if found then
    return query
      select v_existing.id, v_existing.created_at, true,
        v_existing.star_id, s.star_type, s.seed, s.radius, s.position_x, s.position_y, s.position_z,
        s.plane_incl, s.plane_node, false,
        v_existing.orbit_radius, v_existing.orbit_angle, v_existing.orbit_speed,
        v_existing.orbit_inclination, v_existing.orbit_node
      from stars s where s.id = v_existing.star_id;
    return;
  end if;

  -- first candidate (nearest-first) with a free slot wins; lock per-star so
  -- concurrent creators serialize on the capacity check
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

  -- every candidate full: mint a new star deterministically, far out
  if not v_chosen then
    v_is_new := true;
    select coalesce(max(id), 999999) + 1 into v_star_id from stars where id >= 1000000;
    perform pg_advisory_xact_lock(43, v_star_id);
    h := md5(v_star_id::text || 'planets-dynamic-star');
    v_type := (array['yellow','orange','red','white','blue'])[1 + (('x' || substr(h,1,2))::bit(8)::int % 5)];
    v_seed := _hash_unit(h, 3) * 100.0;
    v_srad := 12 + _hash_unit(h, 9) * 16;
    -- position on a large shell, deterministic from the id hash
    v_sx := cos(_hash_unit(h,15) * 2 * pi()) * cos((_hash_unit(h,21) - 0.5) * 0.7) * (22000 + _hash_unit(h,3) * 30000);
    v_sy := sin((_hash_unit(h,21) - 0.5) * 0.7) * (22000 + _hash_unit(h,3) * 30000);
    v_sz := sin(_hash_unit(h,15) * 2 * pi()) * cos((_hash_unit(h,21) - 0.5) * 0.7) * (22000 + _hash_unit(h,3) * 30000);
    v_incl := (_hash_unit(h,9) - 0.5) * 0.7;
    v_node := _hash_unit(h,21) * 2 * pi();
  end if;

  -- make sure the star row exists (first-write-wins for deterministic stars;
  -- fills radius/plane the first time a deterministic star gains a planet)
  insert into stars (id, star_type, seed, radius, position_x, position_y, position_z, plane_incl, plane_node)
  values (v_star_id, v_type, v_seed, v_srad, v_sx, v_sy, v_sz, v_incl, v_node)
  on conflict (id) do update set
    radius     = coalesce(stars.radius, excluded.radius),
    plane_incl = coalesce(stars.plane_incl, excluded.plane_incl),
    plane_node = coalesce(stars.plane_node, excluded.plane_node);

  -- fresh orbital band strictly outside the current outermost occupant, so no
  -- two planets share a slot; angle/direction/jitter are cosmetic (not capacity)
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
  v_oi := v_incl + (random() - 0.5) * 0.24;   -- user planets stay near the plane
  v_on := v_node + (random() - 0.5) * 0.3;

  insert into planets (
    client_ref, name, status, star_id, artwork_path,
    orbit_radius, orbit_angle, orbit_speed, orbit_inclination, orbit_node, orbit_extent,
    satellite_type, satellite_config, surface_type, vibe, scale, rotation_speed, tilt
  ) values (
    p_client_ref, p_planet->>'name', 'visible', v_star_id, p_planet->>'artwork_path',
    v_or, v_oa, v_os, v_oi, v_on, p_extent,
    coalesce(p_planet->>'satellite_type', 'none'), (p_planet->'satellite_config'),
    p_planet->>'surface_type', p_planet->>'vibe',
    (p_planet->>'scale')::real, (p_planet->>'rotation_speed')::real, (p_planet->>'tilt')::real
  ) returning id, created_at into v_pid, v_created;

  return query
    select v_pid, v_created, false,
      v_star_id, v_type, v_seed, v_srad, v_sx, v_sy, v_sz, v_incl, v_node, v_is_new,
      v_or, v_oa, v_os, v_oi, v_on;
end $$;

revoke all on function assign_planet(uuid, jsonb, real, jsonb) from public, anon, authenticated;
grant execute on function assign_planet(uuid, jsonb, real, jsonb) to service_role;
revoke all on function star_capacity(text) from public, anon, authenticated;

import * as THREE from 'three';

// Major stars: actual burning suns, not dots. Each star is a THREE.LOD —
//   near:   animated procedural surface shader + corona shell
//   far:    plain emissive sphere (the glow sprite carries the distance look)
// A star owns its solar system: orbital bands that planets (seeded or
// user-made) can occupy. Data model mirrors a future backend:
//   star { id, position, type, radius, seed } → solar system → planets.

export const STAR_TYPES = {
  yellow: { a: '#ffdf8a', b: '#ff9d3c', c: '#fff7d8', radius: [16, 22], weight: 0.3 },
  orange: { a: '#ffb35c', b: '#e05f1e', c: '#ffe4b8', radius: [14, 19], weight: 0.25 },
  red:    { a: '#ff8a5c', b: '#a12912', c: '#ffc9a1', radius: [20, 28], weight: 0.2 },
  white:  { a: '#eef2ff', b: '#b9c6ff', c: '#ffffff', radius: [12, 17], weight: 0.15 },
  blue:   { a: '#cfe0ff', b: '#5f8cff', c: '#ffffff', radius: [12, 16], weight: 0.1 },
};

export function pickStarType(rand) {
  let roll = rand();
  for (const [name, t] of Object.entries(STAR_TYPES)) {
    roll -= t.weight;
    if (roll <= 0) return name;
  }
  return 'yellow';
}

// slow value-noise plasma — burning, but calm
function makeSurfaceMaterial(type, seed) {
  const t = STAR_TYPES[type];
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSeed: { value: seed },
      uColorA: { value: new THREE.Color(t.a) },
      uColorB: { value: new THREE.Color(t.b) },
      uColorC: { value: new THREE.Color(t.c) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vPos;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vPos = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalMatrix * normal;
        vV = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uSeed;
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      uniform vec3 uColorC;
      varying vec3 vPos;
      varying vec3 vN;
      varying vec3 vV;

      float hash(vec3 p) {
        return fract(sin(dot(p, vec3(127.1, 311.7, 74.7)) + uSeed) * 43758.5453);
      }
      float noise(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
              mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
          mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
              mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
          f.z
        );
      }
      float fbm(vec3 p) {
        float v = 0.0;
        float a = 0.5;
        for (int i = 0; i < 4; i++) {
          v += a * noise(p);
          p *= 2.03;
          a *= 0.5;
        }
        return v;
      }

      void main() {
        // two slowly counter-drifting noise fields feel like convection
        float n1 = fbm(vPos * 2.1 + vec3(uTime * 0.025, 0.0, uTime * 0.018));
        float n2 = fbm(vPos * 3.7 - vec3(0.0, uTime * 0.02, uTime * 0.013));
        float n = n1 * 0.65 + n2 * 0.35;

        vec3 col = mix(uColorB, uColorA, smoothstep(0.32, 0.72, n));
        // bright convective patches
        col += uColorC * smoothstep(0.66, 0.85, n) * 0.55;
        // darker cool spots
        col *= 1.0 - smoothstep(0.3, 0.16, n) * 0.35;
        // fiery limb
        float rim = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        col += uColorC * pow(rim, 2.6) * 0.55;

        gl_FragColor = vec4(col * 1.35, 1.0);
      }
    `,
  });
}

// corona: the same bell-falloff trick as planet atmospheres, warmer and wider
function makeCoronaMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uIntensity: { value: 1.15 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalMatrix * normal;
        vV = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uIntensity;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float rim = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        // brightest right at the star's limb, decaying smoothly outward —
        // no detached halo ring
        float fall = pow(clamp((1.0 - rim) / 0.8, 0.0, 1.0), 2.4);
        float glow = fall * smoothstep(0.02, 0.3, rim) * 1.4 * uIntensity;
        gl_FragColor = vec4(uColor, glow);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

const PROXY_MAT = new THREE.MeshBasicMaterial({ visible: false });
const STAR_GEO = new THREE.SphereGeometry(1, 40, 28);
const STAR_GEO_LOW = new THREE.SphereGeometry(1, 14, 10);

// one shared unit circle reused by every orbit path in the universe
const ORBIT_GEO = (() => {
  const pts = [];
  for (let i = 0; i < 160; i++) {
    const a = (i / 160) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
  }
  return new THREE.BufferGeometry().setFromPoints(pts);
})();

export function buildStar({ id, position, type, radius, seed, plane, glowSprite }) {
  const t = STAR_TYPES[type];

  const lod = new THREE.LOD();
  const near = new THREE.Group();
  const surfaceMat = makeSurfaceMaterial(type, seed);
  const surface = new THREE.Mesh(STAR_GEO, surfaceMat);
  near.add(surface);
  const coronaMat = makeCoronaMaterial(t.c);
  const corona = new THREE.Mesh(STAR_GEO, coronaMat);
  corona.scale.setScalar(1.38);
  near.add(corona);

  const far = new THREE.Mesh(STAR_GEO_LOW, new THREE.MeshBasicMaterial({ color: t.a }));

  lod.addLevel(near, 0);
  lod.addLevel(far, 700);
  lod.addLevel(new THREE.Object3D(), 2600); // beyond this, the beacon point carries it
  lod.position.copy(position);
  lod.scale.setScalar(radius);

  // the halo that reads from across the universe
  const glowTex = glowSprite(t.a, t.b);
  const glowMat = new THREE.SpriteMaterial({
    map: glowTex, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const glow = new THREE.Sprite(glowMat);
  glow.position.copy(position);
  glow.scale.setScalar(radius * 4.2);
  glowMat.opacity = 0.75;

  // orbit paths: one faint additive line material per system, shared by all
  // of its orbit rings so the whole system fades together with distance
  const orbitMat = new THREE.LineBasicMaterial({
    color: t.a,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const orbitGroup = new THREE.Group();
  orbitGroup.visible = false;

  // generous invisible sphere so a distant star is easy to click
  const proxy = new THREE.Mesh(STAR_GEO_LOW, PROXY_MAT);
  proxy.position.copy(position);
  proxy.scale.setScalar(radius * 6);

  // everything about a star is static — freeze all its matrices
  for (const obj of [lod, near, surface, corona, far, glow, proxy]) {
    obj.updateMatrix();
    obj.matrixAutoUpdate = false;
  }

  return {
    id,
    position: position.clone(),
    type,
    radius,
    seed,
    plane,
    proxy,                        // the system's dominant orbital plane
    influence: radius * 3 + 70,   // "you are in this star's neighborhood"
    orbits: [],                   // occupied orbital radii
    orbitGroup,
    orbitMat,
    object: lod,
    glow,
    surfaceMat,
    coronaMat,
    lightColor: new THREE.Color(t.a),
  };
}

// Orbits are unevenly spaced rings on the system's plane (with per-planet
// jitter and the occasional oddball), inner ones faster than outer ones.
// Spacing accounts for each occupant's visual extent (rings, moon orbits),
// so neighbors can't visually collide even where orbital planes intersect.
export function assignOrbit(star, rand = Math.random, extraGap = 0, extent = 3) {
  const base = star.radius * 1.9 + 10 + extent + rand() * 5;
  let radius;
  if (star.orbits.length) {
    const outermost = star.orbits.reduce((a, o) => (o.r + o.e > a.r + a.e ? o : a));
    const gap = 6 + rand() * 9 + (rand() < 0.25 ? 9 : 0); // occasional wide gap
    radius = outermost.r + outermost.e + extent + gap + extraGap;
  } else {
    radius = base + extraGap;
  }
  star.orbits.push({ r: radius, e: extent });
  let incl = star.plane.incl + (rand() - 0.5) * 0.24;
  if (rand() < 0.08) incl += (rand() - 0.5) * 1.1; // the odd one out
  const node = star.plane.node + (rand() - 0.5) * 0.3;
  return {
    starId: star.id,
    center: star.position.clone(),
    radius,
    angle: rand() * Math.PI * 2,
    speed: (2.6 / Math.pow(radius, 0.85)) * (rand() < 0.12 ? -1 : 1), // inner = faster
    incl,
    node,
  };
}

const EULER = new THREE.Euler();
export function orbitQuat(orbit) {
  if (!orbit._q) {
    EULER.set(orbit.incl || 0, orbit.node || 0, 0, 'YXZ');
    orbit._q = new THREE.Quaternion().setFromEuler(EULER);
  }
  return orbit._q;
}

export function orbitPosition(orbit, out) {
  out.set(Math.cos(orbit.angle) * orbit.radius, 0, Math.sin(orbit.angle) * orbit.radius);
  out.applyQuaternion(orbitQuat(orbit));
  return out.add(orbit.center);
}

export function makeOrbitLine(star, orbit) {
  const line = new THREE.LineLoop(ORBIT_GEO, star.orbitMat);
  line.scale.setScalar(orbit.radius);
  line.quaternion.copy(orbitQuat(orbit));
  line.position.copy(star.position);
  line.raycast = () => {};
  // orbit paths never move — don't recompose their matrices every frame
  line.updateMatrix();
  line.matrixAutoUpdate = false;
  star.orbitGroup.add(line);
  return line;
}

export function releaseOrbit(star, orbit, line) {
  const i = star.orbits.findIndex((o) => Math.abs(o.r - orbit.radius) < 1e-6);
  if (i >= 0) star.orbits.splice(i, 1);
  if (line) star.orbitGroup.remove(line);
}

// re-claim a persisted radius, nudging if a seeded planet already took it
export function claimOrbitRadius(star, radius, extent = 3) {
  let r = radius;
  let guard = 0;
  while (guard++ < 200 && star.orbits.some((o) => Math.abs(o.r - r) < o.e + extent + 4)) r += extent + 6;
  star.orbits.push({ r, e: extent });
  return r;
}

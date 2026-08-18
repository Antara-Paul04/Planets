import * as THREE from 'three';
import { mulberry32 } from './textures.js';

// The universe's fixed seed. Everything environmental — star placement,
// asteroid fields, nebulae, density regions — derives from it, so space
// looks the same on every visit. Future galaxies/clusters can be built on
// these same density regions.

export const UNIVERSE_SEED = 20260818;

export function seededRand(salt) {
  return mulberry32((UNIVERSE_SEED ^ salt) >>> 0);
}

// Density regions: a handful of soft spheres where matter congregates.
// Planets, suns and rocks are biased toward them; the space between stays
// sparse and lonely. No labels, no UI — just uneven density.
export function computeRegions() {
  const rand = seededRand(0x7e91);
  const regions = [];
  const n = 4 + Math.floor(rand() * 2);
  for (let i = 0; i < n; i++) {
    const theta = rand() * Math.PI * 2;
    const y = (rand() * 2 - 1) * 0.4;
    const xz = Math.sqrt(Math.max(0, 1 - y * y));
    const dist = 8000 + rand() * 26000;
    regions.push({
      center: new THREE.Vector3(Math.cos(theta) * xz, y, Math.sin(theta) * xz).multiplyScalar(dist),
      radius: 5000 + rand() * 9000,
      weight: 0.5 + rand() * 0.5,
    });
  }
  return regions;
}

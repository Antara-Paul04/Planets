import * as THREE from 'three';

// Soft limb glow: one slightly larger shell, additive. The falloff is a bell
// curve — zero at the planet's face, peaking just past the limb, and fading
// to nothing well before the shell's own silhouette, so there is no hard
// "halo ring" edge around planets.

export function createAtmosphereMaterial(color, intensity) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uIntensity: { value: intensity },
      // world-space direction to this planet's star; set per frame by
      // PlanetField.update so the glow scatters on the day limb, not all around
      uToStar: { value: new THREE.Vector3(0.5, 0.35, 0.79) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vWN;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalMatrix * normal;
        vV = -mv.xyz;
        vWN = mat3(modelMatrix) * normal; // world normal for the day/night term
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uIntensity;
      uniform vec3 uToStar;
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vWN;
      void main() {
        float rim = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        // bell: rises past the limb, dies out before the shell edge
        float glow = rim * rim * pow(1.0 - rim, 1.6) * 9.0 * uIntensity;
        // scatter with the star: bright on the sun-facing limb, a faint rim on
        // the night side -- so it reads as an atmosphere, not a halo ring
        float day = max(dot(normalize(vWN), normalize(uToStar)), 0.0);
        glow *= 0.10 + 0.90 * day;
        gl_FragColor = vec4(uColor, glow);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

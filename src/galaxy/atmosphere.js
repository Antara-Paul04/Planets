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
        // bell: rises past the limb, dies out before the shell edge
        float glow = rim * rim * pow(1.0 - rim, 1.6) * 9.0 * uIntensity;
        gl_FragColor = vec4(uColor, glow);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// Renderer, camera, controls, lighting. The living backdrop (stars, nebulae,
// comets, rocks…) lives in environment.js; planets in planets.js.

export function createScene(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0d1c); // deep navy, not void-black

  // a tiny neutral environment so glassy/metallic planets get real speculars
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.5, 200000);
  camera.position.set(0, 14, 85); // main.js re-homes the camera at a solar system

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 3;
  controls.maxDistance = 60000; // deep into interstellar space
  controls.rotateSpeed = 0.8;   // responsive orbiting in every axis
  controls.panSpeed = 1.1;
  controls.zoomSpeed = 1.15;    // dolly is multiplicative — scale-aware by nature
  // one warm sun + gentle fills — shadow sides stay soft, not ominous
  const sun = new THREE.DirectionalLight(0xffe9c9, 2.4);
  sun.position.set(220, 120, 160);
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0x445070, 0.85));
  scene.add(new THREE.HemisphereLight(0x51608a, 0x2a2038, 0.5));

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return { renderer, scene, camera, controls, sun };
}

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/* ------------------------------------------------------------------ config */
const EYE = 1.62;            // eye height in m
const RADIUS = 0.28;         // body radius for collisions
const STEP = 0.42;           // max step-up height (stairs, tribune steps)
const WALK = 1.45, RUN = 2.9; // m/s
const START = { pos: [0, 0, 6.2], look: [0, 1.5, 0] };
const STATIONS = [
  { id: 'eingang',  label: 'Eingang',       pos: [0.0, 0, 6.2],  look: [0.0, 1.5, 0.0] },
  { id: 'laden',    label: 'Verkaufsraum',  pos: [0.4, 0, 2.6],  look: [-2.4, 1.1, -0.4] },
  { id: 'treppe',   label: 'Treppe',        pos: [2.55, 0, 2.7], look: [2.55, 2.6, -1.6] },
  { id: 'og',       label: 'Obergeschoss',  pos: [0.3, 3, -1.9], look: [0.6, 4.2, 6.0] },
  { id: 'lounge',   label: 'Lounge',        pos: [-0.9, 3, 3.6], look: [2.3, 3.5, 3.8] },
  { id: 'aussen',   label: 'Außen',         pos: [-1.5, 0, 12.5], look: [0.5, 3.2, 0.0] },
];

const isTouch = matchMedia('(pointer: coarse)').matches;
const params = new URLSearchParams(location.search);
const TEST = params.has('test');
const qs = (s) => document.querySelector(s);

/* ------------------------------------------------------------------ renderer */
const canvas = qs('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(TEST ? 1 : Math.min(window.devicePixelRatio, isTouch ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFoveation?.(0.5);

const scene = new THREE.Scene();
// soft daylight sky (gradient), horizon blends into the ground with fog
{
  const c = document.createElement('canvas'); c.width = 16; c.height = 512;
  const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 512);
  gr.addColorStop(0.0, '#7fa6c4'); gr.addColorStop(0.32, '#b4cde0'); gr.addColorStop(0.49, '#e9e6df');
  gr.addColorStop(0.5, '#ddd8cf'); gr.addColorStop(1.0, '#cfc9bf');
  g.fillStyle = gr; g.fillRect(0, 0, 16, 512);
  const t = new THREE.CanvasTexture(c); t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace;
  scene.background = t;
  scene.fog = new THREE.Fog('#e3e0d9', 35, 110);
}
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 400);

const rig = new THREE.Group();          // player feet
scene.add(rig);
rig.add(camera);

/* ------------------------------------------------------------------ ambient occlusion (desktop only, adaptive) */
let composer = null, gtao = null, aoOn = false;
const wantAO = !isTouch && params.get('ao') !== '0';
if (wantAO) {
  const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  gtao = new GTAOPass(scene, camera, innerWidth, innerHeight);
  gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.4, thickness: 1.2, scale: 1.15, samples: 12, distanceFallOff: 1 });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
  gtao.blendIntensity = 0.9;
  composer.addPass(gtao);
  composer.addPass(new OutputPass());
  aoOn = true;
}
// frame-time watchdog: switch AO off on slow machines
const perf = { t: 0, n: 0, checked: false };
function watchPerf(dt) {
  if (!aoOn || perf.checked || mode !== 'walk') return;
  perf.t += dt; perf.n++;
  if (perf.t > 3) {
    perf.checked = true;
    if (perf.t / perf.n > 1 / 40) { aoOn = false; console.info('AO deaktiviert (Leistung)'); }
  }
}

/* ------------------------------------------------------------------ lights */
const sun = new THREE.DirectionalLight('#fff3e4', 3.0);
sun.position.set(-9, 11, 16);
sun.target.position.set(0, 1.5, 0);
sun.castShadow = true;
sun.shadow.mapSize.set(isTouch ? 2048 : 4096, isTouch ? 2048 : 4096);
const sc = sun.shadow.camera;
sc.left = -13; sc.right = 13; sc.top = 13; sc.bottom = -13; sc.near = 1; sc.far = 60;
sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.025;
scene.add(sun, sun.target);

const hemi = new THREE.HemisphereLight('#f4f6f8', '#cfc8bd', 0.45);
scene.add(hemi);

// warm interior pendants (no shadows, cheap)
const warm = [[-1.2, 2.45, 0.5], [1.4, 2.45, -2.5], [-1.2, 5.6, 1.0], [1.6, 5.6, -2.5], [1.8, 5.4, 3.5]];
const warmLights = warm.map((p) => {
  const l = new THREE.PointLight('#ffe9d2', 4.0, 8, 2);
  l.position.set(...p);
  scene.add(l);
  return l;
});

/* ------------------------------------------------------------------ environment */
const pmrem = new THREE.PMREMGenerator(renderer);
new RGBELoader().load('assets/pedestrian_overpass_1k.hdr', (hdr) => {
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  const env = pmrem.fromEquirectangular(hdr).texture;
  scene.environment = env;
  scene.environmentIntensity = 0.8;
  scene.environmentRotation.y = Math.PI * 0.35;
});

/* ------------------------------------------------------------------ materials */
const maxAniso = renderer.capabilities.getMaxAnisotropy();
const tl = new THREE.TextureLoader();
function tex(url, rx = 1, ry = 1, srgb = false) {
  const t = tl.load(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = Math.min(8, maxAniso);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const T = 'assets/tex/';
const plyCol = tex(T + 'plywood_col.jpg', 1 / 2.1, 1 / 1.04, true);
const plyNrm = tex(T + 'plywood_nrm.jpg', 1 / 2.1, 1 / 1.04);
const timCol = tex(T + 'plywood_col.jpg', 1 / 1.3, 1 / 0.65, true);
const conCol = tex(T + 'concrete_col.jpg', 1 / 2.4, 1 / 2.4, true);
const conRgh = tex(T + 'concrete_rough.jpg', 1 / 2.4, 1 / 2.4);
const conNrm = tex(T + 'concrete_nrm.jpg', 1 / 2.4, 1 / 2.4);
const flCol = tex(T + 'floor_col.jpg', 1 / 4, 1 / 4, true);
const flRgh = tex(T + 'floor_rough.jpg', 1 / 4, 1 / 4);
const flNrm = tex(T + 'floor_nrm.jpg', 1 / 4, 1 / 4);
const noise = tex(T + 'noise.jpg', 1, 1);

const M = {
  plywood: new THREE.MeshStandardMaterial({ map: plyCol, color: '#ffffff', normalMap: plyNrm, normalScale: new THREE.Vector2(0.18, 0.18), roughness: 0.58 }),
  green: new THREE.MeshStandardMaterial({ color: '#8aa384', roughness: 0.82 }),
  timber: new THREE.MeshStandardMaterial({ map: timCol, color: '#e7bf8f', normalMap: plyNrm, normalScale: new THREE.Vector2(0.3, 0.3), roughness: 0.7 }),
  boards: new THREE.MeshStandardMaterial({ map: timCol, color: '#efcfa6', roughness: 0.75 }),
  concrete: new THREE.MeshStandardMaterial({ map: conCol, roughnessMap: conRgh, normalMap: conNrm, normalScale: new THREE.Vector2(0.3, 0.3), roughness: 1 }),
  floor: new THREE.MeshStandardMaterial({ map: flCol, color: '#f3eee7', roughnessMap: flRgh, normalMap: flNrm, normalScale: new THREE.Vector2(0.2, 0.2), roughness: 1, envMapIntensity: 1.3 }),
  ceiling: new THREE.MeshStandardMaterial({ color: '#f7f4ef', roughness: 0.95 }),
  plaster: new THREE.MeshStandardMaterial({ color: '#ebe6de', roughness: 0.92, normalMap: conNrm, normalScale: new THREE.Vector2(0.15, 0.15) }),
  facade: new THREE.MeshStandardMaterial({ color: '#3a3d40', roughness: 0.6, metalness: 0.15, normalMap: conNrm, normalScale: new THREE.Vector2(0.2, 0.2) }),
  roofmetal: new THREE.MeshStandardMaterial({ color: '#3b4146', roughness: 0.45, metalness: 0.6 }),
  frame: new THREE.MeshStandardMaterial({ color: '#2b2e31', roughness: 0.38, metalness: 0.55 }),
  rubber: new THREE.MeshStandardMaterial({ color: '#151617', roughness: 0.9 }),
  orange: new THREE.MeshStandardMaterial({ color: '#d9532f', roughness: 0.5, metalness: 0.05 }),
  glass: new THREE.MeshPhysicalMaterial({ color: '#e6f0ee', roughness: 0.03, metalness: 0, transparent: true, opacity: 0.12,
    envMapIntensity: 1.8, depthWrite: false, side: THREE.DoubleSide }),
  p_glass: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.06, transparent: true, opacity: 0.35, envMapIntensity: 1.6, depthWrite: false }),
  surfboard: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06 }),
  p_matte: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, roughnessMap: noise }),
  p_gloss: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3 }),
  p_metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.85 }),
  p_textile: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, normalMap: plyNrm, normalScale: new THREE.Vector2(0.05, 0.05) }),
  p_foliage: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, side: THREE.DoubleSide }),
};
const COLLIDE = new Set(['plywood', 'green', 'concrete', 'floor', 'plaster', 'glass', 'orange', 'facade', 'timber', 'frame']);
const NO_SHADOW_CAST = new Set(['glass', 'p_glass']);

/* ------------------------------------------------------------------ ground / street */
{
  const g = new THREE.CircleGeometry(80, 64);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.MeshStandardMaterial({ map: tex(T + 'floor_col.jpg', 1 / 6, 1 / 6, true), color: '#c4c0b8', roughness: 0.9, envMapIntensity: 0.7 });
  // world-space UVs for the street
  const uv = g.attributes.uv, pos = g.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i), pos.getZ(i));
  const ground = new THREE.Mesh(g, m);
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  ground.name = 'ground';
  scene.add(ground);
  var groundMesh = ground;
}

/* ------------------------------------------------------------------ load model */
const colliders = [groundMesh];
const loader = new GLTFLoader();
const progressBar = qs('#progressBar'), progressLabel = qs('#progressLabel');
let model;
loader.load('assets/surfshop.glb', (gltf) => {
  model = gltf.scene;
  model.traverse((o) => {
    if (!o.isMesh) return;
    const name = o.name.replace(/_\d+$/, '').replace(/\.\d+$/, '');
    const img = o.userData?.image || o.parent?.userData?.image;
    if (img) {
      const t = tl.load('assets/' + img); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = Math.min(8, maxAniso);
      if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
      o.material = new THREE.MeshStandardMaterial({ map: t, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -2 });
      o.receiveShadow = true;
      return;
    }
    const mat = M[name] || M.p_matte;
    o.material = mat;
    o.castShadow = !NO_SHADOW_CAST.has(name);
    o.receiveShadow = true;
    if (name === 'glass' || name === 'p_glass') o.renderOrder = 2;
    if (COLLIDE.has(name)) colliders.push(o);
  });
  scene.add(model);
  model.updateMatrixWorld(true);
  renderer.shadowMap.needsUpdate = true;
  progressBar.style.width = '100%';
  progressLabel.textContent = 'Bereit.';
  setTimeout(() => { qs('#progress').hidden = true; qs('#introActions').hidden = false; }, 350);
}, (e) => {
  const total = e.total || 27_600_000;
  const p = Math.min(99, Math.round((e.loaded / total) * 100));
  progressBar.style.width = p + '%';
  progressLabel.textContent = `Modell wird geladen … ${p} %`;
}, (err) => {
  console.error(err);
  progressLabel.textContent = 'Das Modell konnte nicht geladen werden. Bitte Seite neu laden.';
});

/* ------------------------------------------------------------------ collision helpers */
const ray = new THREE.Raycaster();
ray.firstHitOnly = true;
const DOWN = new THREE.Vector3(0, -1, 0);
const _v = new THREE.Vector3(), _n = new THREE.Vector3();

function groundAt(x, y, z, reach = STEP + 0.05) {
  // highest walkable surface below (y + reach)
  ray.set(_v.set(x, y + reach, z), DOWN);
  ray.far = reach + 30;
  const hits = ray.intersectObjects(colliders, false);
  for (const h of hits) {
    if (!h.face) return h.point.y;
    _n.copy(h.face.normal).transformDirection(h.object.matrixWorld);
    if (_n.y > 0.55) return h.point.y;
  }
  return -Infinity;
}

const _dir = new THREE.Vector3(), _side = new THREE.Vector3();
function blocked(px, feetY, pz, dx, dz, dist) {
  // cast a fan of horizontal rays at several heights; return hit normal if blocked
  _dir.set(dx, 0, dz).normalize();
  _side.set(-_dir.z, 0, _dir.x);
  let best = null;
  for (const h of [STEP + 0.08, 0.8, 1.35]) {
    for (const s of [-0.7, 0, 0.7]) {
      ray.set(_v.set(px + _side.x * s * RADIUS, feetY + h, pz + _side.z * s * RADIUS), _dir);
      ray.far = dist + RADIUS;
      const hit = ray.intersectObjects(colliders, false)[0];
      if (hit && (!best || hit.distance < best.distance)) best = hit;
    }
  }
  if (!best) return null;
  const n = best.face ? best.face.normal.clone().transformDirection(best.object.matrixWorld) : _dir.clone().negate();
  n.y = 0;
  if (n.lengthSq() < 1e-6) n.copy(_dir).negate();
  n.normalize();
  if (n.dot(_dir) > 0) n.negate();
  return n;
}

const vel = { y: 0 };
function moveBody(base, headOffset, dx, dz, dt) {
  // base: rig position (feet); headOffset: xz offset of head vs rig (VR)
  const px = base.x + headOffset.x, pz = base.z + headOffset.z;
  let mx = dx, mz = dz;
  const len = Math.hypot(mx, mz);
  if (len > 1e-5) {
    // slide along up to two surfaces
    for (let i = 0; i < 2; i++) {
      const l = Math.hypot(mx, mz);
      if (l < 1e-6) break;
      const n = blocked(px, base.y, pz, mx, mz, l);
      if (!n) break;
      const d = mx * n.x + mz * n.z;
      mx -= n.x * d; mz -= n.z * d;
    }
    // final safety check
    if (Math.hypot(mx, mz) > 1e-6 && blocked(px, base.y, pz, mx, mz, Math.hypot(mx, mz))) { mx = 0; mz = 0; }
    // never walk off a ledge (stairwell, tribune edge …): the ground ahead may only drop by one step
    const okAt = (ox, oz) => {
      const g = groundAt(px + ox, base.y, pz + oz);
      // probe a little further ahead as well, so we stop before the edge, not on it
      const l = Math.hypot(ox, oz) || 1;
      const g2 = groundAt(px + ox + (ox / l) * RADIUS * 0.6, base.y, pz + oz + (oz / l) * RADIUS * 0.6);
      return g > base.y - STEP && g2 > base.y - STEP;
    };
    if (!okAt(mx, mz)) {
      if (okAt(mx, 0)) mz = 0; else if (okAt(0, mz)) mx = 0; else { mx = 0; mz = 0; }
    }
    base.x += mx; base.z += mz;
  }
  // vertical: follow ground
  const g = groundAt(base.x + headOffset.x, base.y, base.z + headOffset.z);
  if (g !== -Infinity) {
    if (g >= base.y - 0.01) { base.y += (g - base.y) * Math.min(1, dt * 14); vel.y = 0; }
    else {
      vel.y -= 9.81 * dt;
      base.y = Math.max(g, base.y + vel.y * dt);
      if (base.y === g) vel.y = 0;
    }
  }
}

/* ------------------------------------------------------------------ view state */
let yaw = 0, pitch = 0;
let mode = 'intro';          // intro | fly | walk
function lookAtYawPitch(from, to) {
  const d = new THREE.Vector3().subVectors(to, from);
  return { yaw: Math.atan2(-d.x, -d.z), pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)) };
}
function applyView() {
  rig.rotation.set(0, yaw, 0);
  camera.rotation.set(pitch, 0, 0, 'YXZ');
}

/* ------------------------------------------------------------------ intro orbit & fly-in */
let orbitT = 0;
function orbitCamera(dt) {
  orbitT += dt * 0.05;
  const r = 19, a = Math.sin(orbitT) * 0.75 - 0.25;
  rig.position.set(Math.sin(a) * r, 0, Math.cos(a) * r);
  camera.position.set(0, 4.2, 0);
  const v = lookAtYawPitch(new THREE.Vector3(rig.position.x, 4.2, rig.position.z), new THREE.Vector3(1.2, 3.6, 0));
  yaw = v.yaw; pitch = v.pitch; applyView();
}

let fly = null;
function flyTo(st, dur = 1.6) {
  const fromPos = rig.position.clone(); fromPos.y += camera.position.y;
  const to = new THREE.Vector3(...st.pos);
  const g = groundAt(to.x, to.y + 1, to.z, 1.2);
  if (g !== -Infinity) to.y = g;
  const toEye = to.clone(); toEye.y += EYE;
  const v = lookAtYawPitch(toEye, new THREE.Vector3(...st.look));
  // shortest yaw path
  let dy = v.yaw - yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  fly = { t: 0, dur, fromPos, toEye, toFeet: to, y0: yaw, y1: yaw + dy, p0: pitch, p1: v.pitch };
  mode = 'fly';
  setActiveStation(st.id);
}
function updateFly(dt) {
  fly.t += dt / fly.dur;
  const k = fly.t >= 1 ? 1 : 1 - Math.pow(1 - fly.t, 3) * (1 - fly.t) - 0; // ease-out
  const e = fly.t >= 1 ? 1 : (fly.t < 0.5 ? 4 * fly.t ** 3 : 1 - Math.pow(-2 * fly.t + 2, 3) / 2);
  const p = new THREE.Vector3().lerpVectors(fly.fromPos, fly.toEye, e);
  // lift the path a bit for a nicer arc
  p.y += Math.sin(e * Math.PI) * 0.8 * (fly.fromPos.distanceTo(fly.toEye) > 6 ? 1 : 0.2);
  rig.position.set(p.x, fly.toFeet.y, p.z);
  camera.position.set(0, p.y - fly.toFeet.y, 0);
  yaw = fly.y0 + (fly.y1 - fly.y0) * e; pitch = fly.p0 + (fly.p1 - fly.p0) * e;
  applyView();
  if (fly.t >= 1) {
    rig.position.copy(fly.toFeet); camera.position.set(0, EYE, 0);
    fly = null; mode = 'walk';
  }
  void k;
}

/* ------------------------------------------------------------------ UI */
const stationsNav = qs('#stations');
for (const st of STATIONS) {
  const b = document.createElement('button');
  b.className = 'chip'; b.textContent = st.label; b.dataset.id = st.id;
  b.addEventListener('click', (ev) => { ev.stopPropagation(); if (renderer.xr.isPresenting) return; flyTo(st); });
  stationsNav.appendChild(b);
}
function setActiveStation(id) {
  stationsNav.querySelectorAll('.chip').forEach((c) => c.classList.toggle('is-active', c.dataset.id === id));
}

function enterTour() {
  qs('#intro').classList.add('is-hidden');
  qs('#hud').hidden = false;
  if (!isTouch) { qs('#crosshair').hidden = false; qs('#hint').hidden = false; }
  else qs('#joy').hidden = false;
  flyTo(STATIONS[0], 2.6);
}
qs('#btnStart').addEventListener('click', () => { enterTour(); if (!isTouch) setTimeout(() => canvas.requestPointerLock?.(), 50); });
qs('#btnFull').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.();
});
qs('#btnHelp').addEventListener('click', () => { document.exitPointerLock?.(); qs('#help').showModal(); });

/* ------------------------------------------------------------------ desktop input */
const keys = new Set();
addEventListener('keydown', (e) => {
  if (e.target.closest?.('dialog')) return;
  keys.add(e.code);
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

canvas.addEventListener('click', () => {
  if (mode === 'intro' || isTouch) return;
  if (document.pointerLockElement !== canvas) canvas.requestPointerLock?.();
});
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  qs('#hint').classList.toggle('is-faded', locked);
});
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas || mode !== 'walk') return;
  yaw -= e.movementX * 0.0022;
  pitch = THREE.MathUtils.clamp(pitch - e.movementY * 0.0022, -1.45, 1.45);
  applyView();
});
// drag-to-look without pointer lock (fallback, also touch)
let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  if (mode !== 'walk') return;
  if (document.pointerLockElement === canvas) return;
  if (e.pointerType === 'mouse' && !isTouch) return;   // desktop uses pointer lock
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  yaw -= (e.clientX - drag.x) * 0.0045;
  pitch = THREE.MathUtils.clamp(pitch - (e.clientY - drag.y) * 0.0045, -1.45, 1.45);
  drag.x = e.clientX; drag.y = e.clientY; applyView();
});
const endDrag = (e) => { if (drag && e.pointerId === drag.id) drag = null; };
canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);

/* ------------------------------------------------------------------ touch joystick */
const joy = qs('#joy'), knob = qs('#joyKnob');
const stick = { x: 0, y: 0, id: null };
joy.addEventListener('pointerdown', (e) => { stick.id = e.pointerId; joy.setPointerCapture(e.pointerId); joyMove(e); });
joy.addEventListener('pointermove', (e) => { if (e.pointerId === stick.id) joyMove(e); });
const joyEnd = (e) => { if (e.pointerId !== stick.id) return; stick.id = null; stick.x = stick.y = 0; knob.style.transform = ''; };
joy.addEventListener('pointerup', joyEnd); joy.addEventListener('pointercancel', joyEnd);
function joyMove(e) {
  const r = joy.getBoundingClientRect();
  let x = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
  let y = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
  const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
  stick.x = x; stick.y = y;
  knob.style.transform = `translate(${x * 34}px, ${y * 34}px)`;
}

/* ------------------------------------------------------------------ WebXR */
const btnVR = qs('#btnVR'), btnVR2 = qs('#btnVR2'), vrNote = qs('#vrNote');
let xrSupported = false;
if ('xr' in navigator) {
  navigator.xr.isSessionSupported('immersive-vr').then((ok) => {
    xrSupported = ok;
    btnVR.hidden = !ok; btnVR2.hidden = !ok;
    if (!ok) showVrNote();
  }).catch(showVrNote);
} else showVrNote();
function showVrNote() {
  vrNote.hidden = false;
  vrNote.innerHTML = window.isSecureContext
    ? '<b>VR-Brille:</b> Öffne diese Seite im Browser deiner Brille (z.&nbsp;B. Meta Quest Browser) – dann erscheint hier „Mit VR-Brille starten“.'
    : '<b>VR-Brille:</b> VR funktioniert nur über eine sichere Verbindung (https).';
}
let xrSession = null;
async function startVR() {
  if (!xrSupported) return;
  if (xrSession) { xrSession.end(); return; }
  const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
  xrSession = session;
  session.addEventListener('end', () => {
    xrSession = null;
    camera.position.set(0, EYE, 0); applyView();
  });
  warmLights.forEach((l, i) => { l.visible = i === 0 || i === 2; });
  session.addEventListener('end', () => warmLights.forEach((l) => { l.visible = true; }));
  await renderer.xr.setSession(session);
  if (mode !== 'walk') {
    qs('#intro').classList.add('is-hidden'); qs('#hud').hidden = false;
    const st = STATIONS[0];
    rig.position.set(...st.pos);
    const g = groundAt(st.pos[0], 1, st.pos[2], 1.2); if (g !== -Infinity) rig.position.y = g;
    yaw = lookAtYawPitch(new THREE.Vector3(st.pos[0], EYE, st.pos[2]), new THREE.Vector3(...st.look)).yaw;
    fly = null; mode = 'walk';
  }
  // face the station direction; head pitch is controlled by the headset
  rig.rotation.set(0, yaw, 0);
  camera.position.set(0, 0, 0);
}
btnVR.addEventListener('click', startVR);
btnVR2.addEventListener('click', startVR);

// controllers
const ctrlFactory = new XRControllerModelFactory();
const controllers = [];
const teleMarker = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.24, 40).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: '#e2552d', transparent: true, opacity: 0.9, depthTest: false }));
teleMarker.visible = false; teleMarker.renderOrder = 10; scene.add(teleMarker);
for (let i = 0; i < 2; i++) {
  const c = renderer.xr.getController(i);
  const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]);
  const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6 }));
  line.scale.z = 4; line.visible = false; c.add(line);
  c.userData = { aiming: false, line, hand: null };
  c.addEventListener('connected', (e) => { c.userData.hand = e.data.handedness; c.userData.gamepad = e.data.gamepad; });
  c.addEventListener('disconnected', () => { c.userData.hand = null; c.userData.gamepad = null; });
  c.addEventListener('selectstart', () => { c.userData.aiming = true; c.userData.line.visible = true; });
  c.addEventListener('selectend', () => {
    c.userData.aiming = false; c.userData.line.visible = false;
    if (teleMarker.visible) {
      const head = new THREE.Vector3(); camera.getWorldPosition(head);
      const off = head.sub(rig.position); off.y = 0;
      rig.position.set(teleMarker.position.x - off.x, teleMarker.position.y, teleMarker.position.z - off.z);
    }
    teleMarker.visible = false;
  });
  rig.add(c);
  const grip = renderer.xr.getControllerGrip(i);
  grip.add(ctrlFactory.createControllerModel(grip));
  rig.add(grip);
  controllers.push(c);
}
const _m4 = new THREE.Matrix4();
let snapReady = true;
function updateXR(dt) {
  const session = renderer.xr.getSession();
  if (!session) return;
  let mvx = 0, mvz = 0, turn = 0;
  for (const src of session.inputSources) {
    const gp = src.gamepad; if (!gp || gp.axes.length < 2) continue;
    const ax = gp.axes.length >= 4 ? gp.axes[2] : gp.axes[0];
    const ay = gp.axes.length >= 4 ? gp.axes[3] : gp.axes[1];
    if (src.handedness === 'left') { mvx = Math.abs(ax) > 0.15 ? ax : 0; mvz = Math.abs(ay) > 0.15 ? ay : 0; }
    if (src.handedness === 'right') turn = ax;
  }
  // snap turn around the head
  if (Math.abs(turn) > 0.7 && snapReady) {
    snapReady = false;
    const head = new THREE.Vector3(); camera.getWorldPosition(head);
    const ang = -Math.sign(turn) * Math.PI / 6;
    const off = new THREE.Vector3().subVectors(rig.position, head); off.y = 0;
    off.applyAxisAngle(new THREE.Vector3(0, 1, 0), ang);
    rig.position.set(head.x + off.x, rig.position.y, head.z + off.z);
    rig.rotation.y += ang;
  } else if (Math.abs(turn) < 0.3) snapReady = true;
  // smooth locomotion in head direction
  const head = new THREE.Vector3(); camera.getWorldPosition(head);
  const off = new THREE.Vector3().subVectors(head, rig.position); off.y = 0;
  let dx = 0, dz = 0;
  if (mvx || mvz) {
    const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    dx = (fwd.x * -mvz + right.x * mvx) * WALK * 1.2 * dt;
    dz = (fwd.z * -mvz + right.z * mvx) * WALK * 1.2 * dt;
  }
  moveBody(rig.position, off, dx, dz, dt);
  // teleport aiming
  for (const c of controllers) {
    if (!c.userData.aiming) continue;
    _m4.identity().extractRotation(c.matrixWorld);
    ray.set(new THREE.Vector3().setFromMatrixPosition(c.matrixWorld), new THREE.Vector3(0, 0, -1).applyMatrix4(_m4));
    ray.far = 25;
    const hit = ray.intersectObjects(colliders, false)[0];
    if (hit && hit.face) {
      const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      teleMarker.visible = n.y > 0.7;
      teleMarker.position.copy(hit.point); teleMarker.position.y += 0.01;
      c.userData.line.scale.z = hit.distance;
    } else { teleMarker.visible = false; c.userData.line.scale.z = 6; }
  }
}

/* ------------------------------------------------------------------ main loop */
const clock = new THREE.Clock();
const floorLabel = qs('#floorLabel');
let lastFloor = '';
function frame(dtOverride) {
  const dt = dtOverride ?? Math.min(clock.getDelta(), 0.05);
  if (renderer.xr.isPresenting) updateXR(dt);
  else if (mode === 'intro') orbitCamera(dt);
  else if (mode === 'fly') updateFly(dt);
  else if (mode === 'walk') {
    let f = 0, s = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) f += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) f -= 1;
    if (keys.has('KeyA')) s -= 1;
    if (keys.has('KeyD')) s += 1;
    if (keys.has('ArrowLeft')) { yaw += 1.8 * dt; applyView(); }
    if (keys.has('ArrowRight')) { yaw -= 1.8 * dt; applyView(); }
    if (stick.id !== null) { f += -stick.y; s += stick.x; }
    const sp = (keys.has('ShiftLeft') || keys.has('ShiftRight')) ? RUN : WALK;
    let dx = 0, dz = 0;
    const l = Math.hypot(f, s);
    if (l > 0.05) {
      const k = Math.min(1, l) / l;
      f *= k; s *= k;
      const sin = Math.sin(yaw), cos = Math.cos(yaw);
      dx = (-sin * f + cos * s) * sp * dt;
      dz = (-cos * f - sin * s) * sp * dt;
      setActiveStation(null);
    }
    moveBody(rig.position, { x: 0, z: 0 }, dx, dz, dt);
  }
  const fl = rig.position.y > 1.6 ? 'OG' : 'EG';
  if (fl !== lastFloor) { floorLabel.textContent = fl; lastFloor = fl; }
  if (dtOverride === undefined || dtOverride === null) {
    if (aoOn && !renderer.xr.isPresenting && mode !== 'intro') composer.render(dt);
    else renderer.render(scene, camera);
    watchPerf(dt);
  }
}
if (!TEST) renderer.setAnimationLoop(() => frame());

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer?.setSize(innerWidth, innerHeight);
});

// expose for debugging / automated checks
window.__tour = { get aoOn() { return aoOn; }, set aoOn(v) { aoOn = v; }, frame, THREE, scene, camera, rig, renderer, flyTo, STATIONS, colliders, groundAt, get mode() { return mode; }, set mode(v) { mode = v; }, setView(y, p) { yaw = y; pitch = p; applyView(); }, keys };

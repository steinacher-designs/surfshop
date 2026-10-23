import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';

/* ------------------------------------------------------------------ config */
const EYE = 1.62;            // eye height in m
const RADIUS = 0.28;         // body radius for collisions
const STEP = 0.42;           // max step-up height (stairs, tribune steps)
const WALK = 1.45, RUN = 2.9; // m/s
const STATIONS = [
  { id: 'eingang',  label: 'Eingang',       pos: [0.0, 0, 6.2],  look: [0.0, 1.5, 0.0] },
  { id: 'laden',    label: 'Verkaufsraum',  pos: [0.4, 0, 2.6],  look: [-2.4, 1.1, -0.4] },
  { id: 'treppe',   label: 'Treppe',        pos: [2.55, 0, 2.7], look: [2.55, 2.6, -1.6] },
  { id: 'og',       label: 'Obergeschoss',  pos: [0.3, 3, -1.9], look: [0.6, 4.2, 6.0] },
  { id: 'lounge',   label: 'Lounge',        pos: [-0.9, 3, 3.6], look: [2.3, 3.5, 3.8] },
  { id: 'aussen',   label: 'Straße',        pos: [-5.0, 0, 11.5], look: [0.5, 3.5, 0.0] },
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
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = parseFloat(params.get('exp') || '1.0');
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFoveation?.(0.4);

const scene = new THREE.Scene();
{
  const c = document.createElement('canvas'); c.width = 16; c.height = 512;
  const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 512);
  gr.addColorStop(0.0, '#6f9ac2'); gr.addColorStop(0.3, '#a9c5df'); gr.addColorStop(0.49, '#e4e6e6');
  gr.addColorStop(0.5, '#c9c6c0'); gr.addColorStop(1.0, '#b9b5ae');
  g.fillStyle = gr; g.fillRect(0, 0, 16, 512);
  const t = new THREE.CanvasTexture(c); t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace;
  scene.background = t;
  scene.fog = new THREE.Fog('#d9dcdf', 60, 170);
}
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 400);
const rig = new THREE.Group();          // player feet
scene.add(rig);
rig.add(camera);

/* ------------------------------------------------------------------ loading bookkeeping */
const progressBar = qs('#progressBar'), progressLabel = qs('#progressLabel');
const manager = new THREE.LoadingManager();
let loadedFrac = 0;
manager.onProgress = (url, done, total) => {
  loadedFrac = Math.max(loadedFrac, done / total);
  const p = Math.min(99, Math.round(loadedFrac * 100));
  progressBar.style.width = p + '%';
  progressLabel.textContent = `Modell wird geladen … ${p} %`;
};
const maxAniso = renderer.capabilities.getMaxAnisotropy();
const tl = new THREE.TextureLoader(manager);
function tex(url, sx = 1, sy = 1, srgb = true) {
  const t = tl.load(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / sx, 1 / sy);
  t.anisotropy = Math.min(8, maxAniso);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ------------------------------------------------------------------ baked light: lightmaps + probes */
const pmrem = new THREE.PMREMGenerator(renderer);
const PROBES = {};
function loadProbe(name) {
  return new Promise((res) => new RGBELoader(manager).load(`assets/light/${name}.hdr`, (hdr) => {
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    PROBES[name] = pmrem.fromEquirectangular(hdr).texture; hdr.dispose(); res();
  }, undefined, () => res()));
}
const LMTEX = {};
let LMINFO = { scale: {} };

/* ------------------------------------------------------------------ materials (albedo = same textures as the Blender bake) */
const T = 'assets/tex/';
const SPRUCE = [2.1, 1.04];
const plyCol = () => tex(T + 'spruce_col.jpg', ...SPRUCE);
const plyNrm = tex(T + 'plywood_nrm.jpg', ...SPRUCE, false);
const plyRgh = tex(T + 'plywood_rough.jpg', ...SPRUCE, false);
const linHex = (h) => new THREE.Color(h);    // THREE.Color parses sRGB hex into linear working space

function std(o) { return new THREE.MeshStandardMaterial(o); }
const BAKED = {
  plywood: () => std({ map: plyCol(), normalMap: plyNrm, normalScale: new THREE.Vector2(0.25, 0.25), roughnessMap: plyRgh, roughness: 1.0 }),
  green: () => std({ map: plyCol(), color: linHex('#86b3a6'), normalMap: plyNrm, normalScale: new THREE.Vector2(0.25, 0.25), roughnessMap: plyRgh, roughness: 1.0 }),
  floor: () => std({ map: tex(T + 'terrazzo_col.jpg', 1.235, 1.235), roughness: 0.32 }),
  ceiling: () => std({ color: linHex('#efebe4'), roughness: 0.9 }),
  plaster: () => std({ map: tex(T + 'white_plaster_02_col.jpg', 2, 2), roughness: 0.9 }),
  concrete: () => std({ map: tex(T + 'concrete_floor_02_col.jpg', 2.5, 2.5), roughness: 0.8 }),
  facade: () => std({ map: tex(T + 'plastered_wall_04_col.jpg', 2, 2), color: linHex('#5a5e62'), roughness: 0.8 }),
  orange: () => std({ color: linHex('#d4502c'), roughness: 0.45, metalness: 0.1 }),
  roofmetal: () => std({ color: linHex('#3a4045'), roughness: 0.4, metalness: 0.6 }),
  nb_plaster_a: () => std({ map: tex(T + 'yellow_plaster_col.jpg', 2.5, 2.5), roughness: 0.9 }),
  nb_plaster_b: () => std({ map: tex(T + 'beige_wall_001_col.jpg', 2.5, 2.5), roughness: 0.9 }),
  nb_plaster_c: () => std({ map: tex(T + 'plastered_wall_04_col.jpg', 2.5, 2.5), color: linHex('#ece6da'), roughness: 0.9 }),
  nb_stone: () => std({ map: tex(T + 'plastered_wall_04_col.jpg', 2, 2), color: linHex('#b7b0a4'), roughness: 0.85 }),
  walk: () => std({ map: tex(T + 'granite_tile_03_col.jpg', 2, 2), roughness: 0.8 }),
  curb: () => std({ color: linHex('#4a4a4a'), roughness: 0.6, metalness: 0.4 }),
  road: () => std({ map: tex(T + 'granite_tile_col.jpg', 2, 2), roughness: 0.85 }),
};
const DYN = {
  frame: () => std({ color: linHex('#2a2d30'), roughness: 0.35, metalness: 0.6 }),
  rubber: () => std({ color: linHex('#141516'), roughness: 0.85 }),
  glass: () => new THREE.MeshPhysicalMaterial({ color: '#eef4f3', roughness: 0.02, transparent: true, opacity: 0.1, envMapIntensity: 1.4, depthWrite: false, side: THREE.DoubleSide }),
  nb_glass: () => std({ color: linHex('#1c2226'), roughness: 0.05, metalness: 0.2, envMapIntensity: 1.2 }),
  nb_frame: () => std({ color: linHex('#e6e2da'), roughness: 0.5 }),
  nb_shopglass: () => std({ color: linHex('#202629'), roughness: 0.03, metalness: 0.1, envMapIntensity: 1.3 }),
  nb_shopframe: () => std({ color: linHex('#2a2c2e'), roughness: 0.4, metalness: 0.6 }),
  nb_roof: () => std({ map: tex(T + 'grey_roof_tiles_col.jpg', 3, 3), roughness: 0.8 }),
  ground_far: () => std({ map: tex(T + 'granite_tile_col.jpg', 2, 2), color: linHex('#9a9a9a'), roughness: 0.9 }),
  p_glass: () => new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.05, transparent: true, opacity: 0.35, envMapIntensity: 1.4, depthWrite: false }),
  surfboard: () => new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.05 }),
  p_matte: () => std({ vertexColors: true, roughness: 0.7 }),
  p_gloss: () => std({ vertexColors: true, roughness: 0.3 }),
  p_metal: () => std({ vertexColors: true, roughness: 0.3, metalness: 0.85 }),
  p_textile: () => std({ vertexColors: true, roughness: 0.95 }),
  p_foliage: () => std({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide }),
};
const COLLIDE = new Set(['plywood', 'green', 'floor', 'plaster', 'concrete', 'glass', 'orange', 'facade', 'frame', 'walk', 'curb', 'road',
  'nb_plaster_a', 'nb_plaster_b', 'nb_plaster_c', 'nb_stone', 'nb_glass', 'nb_shopglass', 'ground_far']);

// which probe lights a dynamic object: EG / OG interior or the street
function probeFor(y, inside) {
  if (!inside) return PROBES.probe_ext || PROBES.probe_eg;
  return y > 2.9 ? (PROBES.probe_og || PROBES.probe_eg) : PROBES.probe_eg;
}
const SHOP = { minX: -3.55, maxX: 3.55, minZ: -7.2, maxZ: 7.0 };   // shop footprint in scene coordinates
const inShop = (p) => p.x > SHOP.minX && p.x < SHOP.maxX && p.z > SHOP.minZ && p.z < SHOP.maxZ;

/* ------------------------------------------------------------------ load everything */
const colliders = [];
const gltfLoader = new GLTFLoader(manager);
const loadGLB = (u) => new Promise((res, rej) => gltfLoader.load(u, res, undefined, rej));
const matCache = new Map();
function cached(key, make) { if (!matCache.has(key)) matCache.set(key, make()); return matCache.get(key); }
let model;

async function loadAll() {
  LMINFO = await fetch('assets/light/lightmaps.json').then((r) => r.json()).catch(() => ({ scale: {} }));
  await Promise.all(['probe_eg', 'probe_og', 'probe_ext'].map(loadProbe));
  for (const g of Object.keys(LMINFO.scale)) {
    const t = tl.load(`assets/light/${g}.jpg`);
    t.colorSpace = THREE.SRGBColorSpace; t.channel = 1; t.flipY = false;
    t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.anisotropy = Math.min(4, maxAniso);
    LMTEX[g] = t;
  }
  const gltf = await loadGLB('assets/surfshop.glb');
  model = gltf.scene;
  const v = new THREE.Vector3();
  model.updateMatrixWorld(true);
  model.traverse((o) => {
    if (!o.isMesh) return;
    const name = o.name.replace(/\.\d+$/, '');
    const ex = { ...(o.parent?.userData || {}), ...(o.userData || {}) };
    const lmg = ex.lightmap;
    o.geometry.computeBoundingBox();
    o.geometry.boundingBox.getCenter(v); o.localToWorld(v);
    let mat;
    if (ex.image) {
      if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
      mat = std({ map: tex('assets/' + ex.image), roughness: 0.6 });
      mat.map.repeat.set(1, 1);
      mat.polygonOffset = true; mat.polygonOffsetFactor = -2; mat.polygonOffsetUnits = -2;
      if (ex.alpha) {
        mat.map.wrapS = mat.map.wrapT = THREE.ClampToEdgeWrapping;
        mat.transparent = true; mat.depthWrite = false; mat.alphaTest = 0.03;
        mat.roughness = ex.glossy ? 0.35 : 0.75;
        o.renderOrder = 1 + (ex.order || 0);
      }
      if (!lmg) { mat.envMap = probeFor(v.y, inShop(v)); mat.envMapIntensity = 1.0; }
    } else if (lmg && BAKED[name]) {
      mat = cached(name, BAKED[name]);
    } else {
      const inside = inShop(v);
      const key = name + '|' + (inside ? (v.y > 2.9 ? 'og' : 'eg') : 'ext');
      mat = cached(key, () => { const m = (DYN[name] || DYN.p_matte)(); m.envMap = probeFor(v.y, inside); return m; });
    }
    if (lmg && LMTEX[lmg]) {
      if (ex.image) mat = mat;   // posters are unique materials
      mat.lightMap = LMTEX[lmg];
      mat.lightMapIntensity = Math.PI * (LMINFO.scale[lmg] || 1);
      // only a little image based light on baked surfaces (for sheen / reflections) – the lightmap carries the light
      mat.envMap = PROBES.probe_eg; mat.envMapIntensity = name === 'floor' ? 0.35 : 0.12;
      if (lmg !== 'lm_int') { mat.envMap = PROBES.probe_ext; mat.envMapIntensity = 0.12; }
    }
    o.material = mat;
    if (name === 'roofmetal') o.visible = false;   // no roof overhang
    if (name === 'glass' || name === 'p_glass') o.renderOrder = 2;
    if (COLLIDE.has(name)) colliders.push(o);
  });
  scene.add(model);
  model.updateMatrixWorld(true);
  await loadAssets();
}

/* ---- real 3D assets (folded clothes, shirts, caps, ivy, street lamps) as GPU instances */
const C_B2T = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1);   // Blender Z-up -> three Y-up
const C_T2B = C_B2T.clone().invert();
const POLO_COLORS = ['#f2efe8', '#1f2b3a', '#d8c7a6', '#d4502c', '#2f6f73', '#202020'];
async function loadAssets() {
  let inst = [];
  try { inst = await fetch('assets/models/instances.json').then((r) => r.json()); } catch (e) { return; }
  const byAsset = {};
  for (const it of inst) (byAsset[it.asset] ||= []).push(it);
  const mb = new THREE.Matrix4(), mt = new THREE.Matrix4(), pos = new THREE.Vector3();
  await Promise.all(Object.entries(byAsset).map(async ([asset, list]) => {
    let g;
    try { g = await loadGLB(`assets/models/ASSET_${asset}.glb`); } catch (e) { console.warn('asset missing', asset); return; }
    const meshes = [];
    g.scene.updateMatrixWorld(true);
    g.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
    for (const src of meshes) {
      let material = src.material;
      const tinted = asset === 'polo' || asset === 'hoodie';
      if (tinted) { material = material.clone(); material.map = null; material.color.set('#ffffff'); }
      // plants: keep the foliage in a deep, dark green
      if (/plant/.test(asset) && !Array.isArray(material) && /lea(f|ves)/i.test(material.name || '')) {
        material = material.clone(); material.color.multiply(new THREE.Color(0.36, 0.56, 0.38));
      }
      const im = new THREE.InstancedMesh(src.geometry, material, list.length);
      list.forEach((it, i) => {
        mb.set(...it.m.flat());
        mt.multiplyMatrices(C_B2T, mb).multiply(C_T2B).multiply(src.matrixWorld);
        im.setMatrixAt(i, mt);
        if (tinted) im.setColorAt(i, new THREE.Color(POLO_COLORS[(i * 7 + (asset === 'hoodie' ? 1 : 3)) % POLO_COLORS.length]));
      });
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      // light the asset from the probe of the floor it stands on (first instance decides)
      mt.multiplyMatrices(C_B2T, mb.set(...list[0].m.flat())).multiply(C_T2B); pos.setFromMatrixPosition(mt);
      const mats = Array.isArray(material) ? material : [material];
      for (const m of mats) { m.envMap = probeFor(pos.y, inShop(pos)); m.envMapIntensity = 1.0; }
      im.frustumCulled = asset !== 'street_lamp_02';
      scene.add(im);
    }
  }));
}

loadAll().then(() => {
  progressBar.style.width = '100%';
  progressLabel.textContent = 'Bereit.';
  setTimeout(() => { qs('#progress').hidden = true; qs('#introActions').hidden = false; }, 350);
}).catch((err) => {
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
  orbitT += dt * 0.06;
  // slow dolly along the shopping street, looking at the shop front
  rig.position.set(Math.sin(orbitT) * 9 - 2, 0, 15.5);
  camera.position.set(0, 2.2, 0);
  const v = lookAtYawPitch(new THREE.Vector3(rig.position.x, 2.2, rig.position.z), new THREE.Vector3(0.4, 4.2, 4));
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
    renderer.render(scene, camera);
  }
}
if (!TEST) renderer.setAnimationLoop(() => frame());

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// expose for debugging / automated checks
window.__tour = { frame, PROBES, LMTEX, THREE, scene, camera, rig, renderer, flyTo, STATIONS, colliders, groundAt, get mode() { return mode; }, set mode(v) { mode = v; }, setView(y, p) { yaw = y; pitch = p; applyView(); }, keys };

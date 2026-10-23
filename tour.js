// 360° Rundgang – path-traced Blender panoramas, hotspots, floor plan, gyro and WebXR
import * as THREE from 'three';

const qs = (s) => document.querySelector(s);
const canvas = qs('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local');

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 200);
camera.rotation.order = 'YXZ';
const rig = new THREE.Group(); rig.add(camera); scene.add(rig);

const TOUR = await fetch('assets/tour/tour.json').then((r) => r.json());
const PLAN = await fetch('assets/tour/plan.json').then((r) => r.json());
const BY = Object.fromEntries(TOUR.points.map((p) => [p.id, p]));
const MARKERS = { 'treppe>og_treppe': [2.55, 1.35, -0.6], 'og_treppe>treppe': [2.55, 2.55, -2.3] };
const maxTex = renderer.capabilities.maxTextureSize;
const HI = maxTex >= 8192 ? '4k' : (maxTex >= 4096 ? '4k' : '2k');

/* ---------------------------------------------------------------- panorama spheres (two for cross-fading) */
// Blender equirect: image centre = scene -Z, right = +X  ->  u' = 0.25 - u on three's sphere
function sphere() {
  const g = new THREE.SphereGeometry(50, 96, 64);
  const m = new THREE.MeshBasicMaterial({ side: THREE.BackSide, transparent: true, opacity: 1, depthWrite: false, toneMapped: false });
  const s = new THREE.Mesh(g, m); s.renderOrder = -2; scene.add(s); return s;
}
const sA = sphere(), sB = sphere(); sB.visible = false;
const loader = new THREE.TextureLoader();
const texCache = {};
function prepTex(t) {
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.repeat.set(-1, 1); t.offset.set(0.25, 0);
  t.minFilter = THREE.LinearMipmapLinearFilter; t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return t;
}
function loadTex(id, res) {
  const key = id + '_' + res;
  if (!texCache[key]) texCache[key] = new Promise((ok, err) => loader.load(`assets/pano/${id}_${res}.jpg`, (t) => ok(prepTex(t)), undefined, err));
  return texCache[key];
}

/* ---------------------------------------------------------------- hotspots */
function ringTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
  x.beginPath(); x.arc(128, 128, 104, 0, Math.PI * 2); x.fillStyle = 'rgba(255,255,255,0.18)'; x.fill();
  x.lineWidth = 16; x.strokeStyle = 'rgba(255,255,255,0.95)'; x.stroke();
  x.beginPath(); x.arc(128, 128, 30, 0, Math.PI * 2); x.fillStyle = '#ffffff'; x.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function labelTexture(text) {
  const c = document.createElement('canvas'); const x = c.getContext('2d');
  x.font = '600 44px "IBM Plex Mono", monospace'; const w = Math.ceil(x.measureText(text).width) + 56;
  c.width = w; c.height = 84; x.font = '600 44px "IBM Plex Mono", monospace';
  x.fillStyle = 'rgba(36,65,77,0.92)'; x.beginPath(); x.roundRect(0, 0, w, 84, 42); x.fill();
  x.fillStyle = '#ece2cc'; x.textBaseline = 'middle'; x.fillText(text, 28, 44);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return { t, aspect: w / 84 };
}
const RING = ringTexture();
const hotspots = new THREE.Group(); scene.add(hotspots);
let current = null;
function buildHotspots(p) {
  hotspots.clear();
  const eye = new THREE.Vector3(...p.pos);
  for (const id of p.links) {
    const q = BY[id];
    const m = MARKERS[p.id + '>' + id];
    const target = m ? new THREE.Vector3(...m) : new THREE.Vector3(q.pos[0], q.pos[1] - 1.6 + 0.02, q.pos[2]);
    const rel = target.clone().sub(eye);
    const d = rel.length();
    if (d > 45) rel.multiplyScalar(45 / d);
    const grp = new THREE.Group(); grp.position.copy(rel); grp.userData.id = id;
    const r = THREE.MathUtils.clamp(0.16 + d * 0.035, 0.22, 0.75);
    const ring = new THREE.Mesh(new THREE.CircleGeometry(r, 48), new THREE.MeshBasicMaterial({ map: RING, transparent: true, depthTest: false, toneMapped: false }));
    ring.rotation.x = -Math.PI / 2; ring.renderOrder = 5; ring.userData.id = id; grp.add(ring);
    const lt = labelTexture(q.label);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: lt.t, depthTest: false, toneMapped: false, transparent: true }));
    const h = THREE.MathUtils.clamp(0.06 + d * 0.022, 0.1, 0.5);
    sp.scale.set(h * lt.aspect, h, 1); sp.position.y = r * 0.6 + h * 0.9; sp.renderOrder = 6; sp.userData.id = id; grp.add(sp);
    hotspots.add(grp);
  }
}

/* ---------------------------------------------------------------- navigation */
let yaw = 0, pitch = 0, fov = 75, busy = false;
async function go(id, first = false) {
  if (busy || (current && current.id === id)) return;
  busy = true;
  const p = BY[id];
  let lookYaw = null;
  if (current && !first) {
    const d = new THREE.Vector3(...p.pos).sub(new THREE.Vector3(...current.pos));
    lookYaw = Math.atan2(-d.x, -d.z);
  }
  const tex = await loadTex(id, '2k');
  const from = first ? null : sA;
  sB.material.map = tex; sB.material.needsUpdate = true; sB.material.opacity = 0; sB.visible = true;
  hotspots.visible = false;
  const t0 = performance.now(), D = first ? 10 : 650;
  const startFov = fov;
  await new Promise((res) => {
    function step() {
      const k = Math.min(1, (performance.now() - t0) / D), e = k * k * (3 - 2 * k);
      sB.material.opacity = e;
      if (from) { from.material.opacity = 1 - e; fov = startFov - 18 * Math.sin(k * Math.PI) * 0.6; }
      if (k < 1) requestAnimationFrame(step); else res();
    }
    step();
  });
  fov = startFov;
  sA.material.map = tex; sA.material.opacity = 1; sA.material.needsUpdate = true; sB.visible = false;
  current = p;
  buildHotspots(p); hotspots.visible = true;
  if (lookYaw !== null && Math.abs(lookYaw - yaw) > 0.01) { /* keep direction of travel */ yaw = lookYaw; }
  updateUI();
  busy = false;
  // upgrade to the sharp version
  if (HI !== '2k') loadTex(id, HI).then((t) => { if (current && current.id === id) { sA.material.map = t; sA.material.needsUpdate = true; } }).catch(() => {});
  // warm the neighbours
  for (const n of p.links) loadTex(n, '2k').catch(() => {});
}

/* ---------------------------------------------------------------- input: drag / zoom / click */
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let drag = null, moved = 0;
const pointers = new Map();
function pick(x, y) {
  ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(hotspots.children, true)[0];
  return hit ? hit.object.userData.id : null;
}
canvas.addEventListener('pointerdown', (e) => {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  canvas.setPointerCapture(e.pointerId);
  drag = { x: e.clientX, y: e.clientY, yaw, pitch }; moved = 0; canvas.classList.add('is-dragging');
});
canvas.addEventListener('pointermove', (e) => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()]; const dist = Math.hypot(a.x - b.x, a.y - b.y);
    if (drag.pinch) fov = THREE.MathUtils.clamp(fov * drag.pinch / dist, 35, 95);
    drag.pinch = dist; moved = 99; return;
  }
  if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; moved = Math.max(moved, Math.hypot(dx, dy));
    const s = (fov / innerHeight) * (Math.PI / 180);
    yaw = drag.yaw + dx * s; pitch = THREE.MathUtils.clamp(drag.pitch + dy * s, -1.45, 1.45);
    gyroOff = null;
  } else {
    const id = pick(e.clientX, e.clientY);
    canvas.classList.toggle('is-hot', !!id);
    const tip = qs('#tip');
    if (id) { tip.textContent = BY[id].label; tip.style.left = e.clientX + 'px'; tip.style.top = e.clientY + 'px'; tip.hidden = false; } else tip.hidden = true;
  }
});
function endPointer(e) {
  pointers.delete(e.pointerId);
  if (pointers.size === 0) {
    canvas.classList.remove('is-dragging');
    if (drag && moved < 6) { const id = pick(e.clientX, e.clientY); if (id) go(id); }
    drag = null;
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', (e) => { e.preventDefault(); fov = THREE.MathUtils.clamp(fov + e.deltaY * 0.04, 35, 95); }, { passive: false });
addEventListener('keydown', (e) => {
  const k = e.key;
  if (k === 'ArrowLeft') yaw += 0.08; if (k === 'ArrowRight') yaw -= 0.08;
  if (k === 'ArrowUp') pitch = Math.min(1.4, pitch + 0.06); if (k === 'ArrowDown') pitch = Math.max(-1.4, pitch - 0.06);
});

/* ---------------------------------------------------------------- gyroscope (phones) */
let gyro = null, gyroOff = null;
const zee = new THREE.Vector3(0, 0, 1), q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)), eul = new THREE.Euler();
function onOrient(e) { if (e.alpha != null) gyro = e; }
async function enableGyro() {
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
      if ((await DeviceOrientationEvent.requestPermission()) !== 'granted') return;
    }
    addEventListener('deviceorientation', onOrient); qs('#btnGyro').classList.add('is-on'); gyroOff = null;
  } catch (err) { console.warn(err); }
}
function gyroQuat() {
  const d = THREE.MathUtils.DEG2RAD;
  eul.set(gyro.beta * d, gyro.alpha * d, -gyro.gamma * d, 'YXZ');
  const q = new THREE.Quaternion().setFromEuler(eul).multiply(q1);
  const orient = (screen.orientation?.angle || 0) * d;
  q.multiply(new THREE.Quaternion().setFromAxisAngle(zee, -orient));
  return q;
}

/* ---------------------------------------------------------------- floor plan */
const svg = qs('#mapSvg');
let mapFloor = 'eg';
const VB = { eg: [-4.2, -7.8, 11.4, 22.6], og: [-4.2, -7.8, 8.4, 15.4] };
function drawMap() {
  const vb = VB[mapFloor];
  svg.setAttribute('viewBox', vb.join(' '));
  const P = PLAN[mapFloor];
  let h = mapFloor === 'eg' ? `<rect class="street" x="-12" y="7.2" width="30" height="8"/>` : '';
  for (const k of ['glass', 'stair', 'wall']) if (P[k]) h += `<path class="${k}" d="${P[k]}"/>`;
  if (current && current.floor === mapFloor) {
    const [x, , z] = current.pos; const a = -yaw - Math.PI / 2, w = (fov * Math.PI / 180) * 0.6, R = 2.2;
    h += `<path class="cone" id="cone" d="M${x} ${z}L${x + R * Math.cos(a - w)} ${z + R * Math.sin(a - w)}A${R} ${R} 0 0 1 ${x + R * Math.cos(a + w)} ${z + R * Math.sin(a + w)}Z"/>`;
  }
  for (const p of TOUR.points) if (p.floor === mapFloor) h += `<circle class="pt${current && current.id === p.id ? ' is-here' : ''}" data-id="${p.id}" cx="${p.pos[0]}" cy="${p.pos[2]}" r="0.42"><title>${p.label}</title></circle>`;
  svg.innerHTML = h;
}
svg.addEventListener('click', (e) => { const id = e.target.dataset?.id; if (id) go(id); });
document.querySelectorAll('.map__tabs button').forEach((b) => b.addEventListener('click', () => {
  mapFloor = b.dataset.floor; document.querySelectorAll('.map__tabs button').forEach((x) => x.classList.toggle('is-active', x === b)); drawMap();
}));

/* ---------------------------------------------------------------- HUD */
const nav = qs('#stations');
for (const p of TOUR.points) {
  const b = document.createElement('button'); b.className = 'chip'; b.textContent = p.label; b.dataset.id = p.id;
  b.addEventListener('click', () => go(p.id)); nav.appendChild(b);
}
function updateUI() {
  nav.querySelectorAll('.chip').forEach((c) => c.classList.toggle('is-active', c.dataset.id === current.id));
  qs('#floorLabel').textContent = current.floor === 'og' ? 'OG' : (current.id.startsWith('strasse') ? 'Straße' : 'EG');
  if (mapFloor !== current.floor) { mapFloor = current.floor; document.querySelectorAll('.map__tabs button').forEach((x) => x.classList.toggle('is-active', x.dataset.floor === mapFloor)); }
  drawMap();
}
qs('#btnFull').addEventListener('click', () => { if (!document.fullscreenElement) document.documentElement.requestFullscreen?.(); else document.exitFullscreen?.(); });
if (matchMedia('(pointer: coarse)').matches && 'DeviceOrientationEvent' in window) { qs('#btnGyro').hidden = false; qs('#btnGyro').addEventListener('click', enableGyro); }

/* ---------------------------------------------------------------- WebXR */
let xrSupported = false;
if (navigator.xr) xrSupported = await navigator.xr.isSessionSupported('immersive-vr').catch(() => false);
async function enterVR() {
  const s = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
  await renderer.xr.setSession(s);
}
if (xrSupported) { qs('#btnVR').hidden = false; qs('#btnVR2').hidden = false; qs('#btnVR').addEventListener('click', start.bind(null, true)); qs('#btnVR2').addEventListener('click', enterVR); }
const controllers = [0, 1].map((i) => {
  const c = renderer.xr.getController(i);
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -8)]), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }));
  c.add(line); scene.add(c);
  c.addEventListener('select', () => {
    const m = new THREE.Matrix4().extractRotation(c.matrixWorld);
    ray.ray.origin.setFromMatrixPosition(c.matrixWorld); ray.ray.direction.set(0, 0, -1).applyMatrix4(m);
    const hit = ray.intersectObjects(hotspots.children, true)[0]; if (hit) go(hit.object.userData.id);
  });
  return c;
});

/* ---------------------------------------------------------------- loop */
let started = false, autoT = 0;
function frame() {
  if (!renderer.xr.isPresenting) {
    if (gyro) {
      const q = gyroQuat();
      if (gyroOff === null) { const e = new THREE.Euler().setFromQuaternion(q, 'YXZ'); gyroOff = yaw - e.y; }
      camera.quaternion.copy(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), gyroOff).multiply(q));
      const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ'); yaw = e.y; pitch = e.x;
    } else {
      if (!started) { autoT += 0.0012; yaw = -autoT; }
      camera.rotation.set(pitch, yaw, 0);
    }
    camera.fov += (fov - camera.fov) * 0.25; camera.updateProjectionMatrix();
    // keep the spheres centred on the eye
    sA.position.set(0, 0, 0); sB.position.set(0, 0, 0);
  } else {
    // in VR the head moves a little – keep the panorama glued to it
    const p = new THREE.Vector3(); renderer.xr.getCamera().getWorldPosition(p);
    sA.position.copy(p); sB.position.copy(p); hotspots.position.set(p.x, p.y, p.z);
  }
  if (current && current.floor === mapFloor && !renderer.xr.isPresenting) {
    const cone = svg.querySelector('#cone');
    if (cone) { const [x, , z] = current.pos; const a = -yaw - Math.PI / 2, w = (camera.fov * Math.PI / 180) * 0.6, R = 2.2;
      cone.setAttribute('d', `M${x} ${z}L${x + R * Math.cos(a - w)} ${z + R * Math.sin(a - w)}A${R} ${R} 0 0 1 ${x + R * Math.cos(a + w)} ${z + R * Math.sin(a + w)}Z`); }
  }
  renderer.render(scene, camera);
}
renderer.setAnimationLoop(frame);
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

/* ---------------------------------------------------------------- start */
function start(vr) {
  started = true;
  qs('#intro').classList.add('is-hidden'); qs('#hud').hidden = false; qs('#map').hidden = false;
  const hint = qs('#hint'); hint.hidden = false; setTimeout(() => hint.classList.add('is-faded'), 4500);
  if (vr === true) enterVR();
}
qs('#btnStart').addEventListener('click', () => start(false));
try {
  await go(TOUR.start, true);
  qs('#progressBar').style.width = '100%'; qs('#progressLabel').textContent = 'Bereit.';
} catch (e) {
  qs('#progressLabel').textContent = 'Die 360°-Bilder sind noch nicht hochgeladen.';
}
setTimeout(() => { qs('#progress').hidden = true; qs('#introActions').hidden = false; }, 300);
window.__tour = { go, get yaw() { return yaw; }, set yaw(v) { yaw = v; }, set pitch(v) { pitch = v; }, start, renderer, camera, scene };

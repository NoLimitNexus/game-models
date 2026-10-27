// Shared pieces: random numbers, the land's shape, the renderer, the clock, the log and model loading.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export const CDN = 'https://polyfork.dev/cdn/';
export const DAY = 720;   // real seconds in one day at 1x
const params = new URLSearchParams(location.search);
export const START_HOUR = +(params.get('h') ?? 15);

// ------------------------------------------------------------------ random + noise
let seed = 20261027;
export const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
export const rr = (a, b) => a + rnd() * (b - a);
export const pick = a => a[Math.floor(rnd() * a.length)];
export const lerpAngle = (a, b, t) => { let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI; if (d < -Math.PI) d += Math.PI * 2; return a + d * t; };
export const faceYaw = (fx, fz, tx, tz) => Math.atan2(tx - fx, tz - fz);
export const V = (x, z, y = 0) => new THREE.Vector3(x, y, z);
export const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hash = (x, z) => { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); };
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), w = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return (a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w) * 2 - 1;
}
export const fbm = (x, z) => vnoise(x, z) * 0.6 + vnoise(x * 2.1 + 5, z * 2.1 + 3) * 0.28 + vnoise(x * 4.3 + 9, z * 4.3 + 1) * 0.12;

// ------------------------------------------------------------------ the land
export const WATER_Y = -0.55;
export const FORT = { x: 0, z: -172, r: 34, h: 11 };
export const LAKE = { x: 112, z: -84, r: 30 };
export const STREAM = [[112, -54], [118, -30], [126, -4], [130, 24], [134, 60]];
export const PIERS = [{ x: 0, z0: 40, z1: 92 }, { x: 34, z0: 44, z1: 84 }];
export const BRIDGE = { x: 127, z: 6, r: 6 };
export const shore = x => 50 + 5 * Math.sin(x * 0.017) + 3 * Math.sin(x * 0.047 + 1);
function distSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}
export function distPolyline(x, z, pts) { let d = 1e9; for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, distSeg(x, z, ...pts[i], ...pts[i + 1])); return d; }
export function heightAt(x, z) {
  const dTown = Math.hypot(x * 0.8, z);
  let h = (fbm(x * 0.007, z * 0.007) * 16 + fbm(x * 0.03 + 7, z * 0.03) * 2.5 + 3) * smooth(70, 160, dTown);
  h = Math.max(h, 0) + Math.min(h, 0) * 0.3;
  const dc = Math.hypot(x - FORT.x, z - FORT.z);
  h = Math.max(h, FORT.h * (1 - smooth(FORT.r, FORT.r + 44, dc)));
  const dl = Math.hypot(x - LAKE.x, z - LAKE.z);
  if (dl < LAKE.r + 16) h = h * smooth(LAKE.r - 10, LAKE.r + 16, dl) - 2.4 * (1 - smooth(LAKE.r - 8, LAKE.r + 2, dl));
  const ds = distPolyline(x, z, STREAM);
  if (ds < 9) h = h * smooth(2, 9, ds) - 1.3 * (1 - smooth(1.5, 4, ds));
  const k = z - (shore(x) - 9);
  if (k > 0) { h = h + (0.25 - h) * smooth(0, 3, k) - Math.max(0, k - 3) * 0.13; h = Math.max(h, -7); }
  return h;
}
// heights on a 2 m grid, read back with bilinear blending: the people and animals ask thousands of times a frame
const G = { x0: -450, z0: -450, step: 2, nx: 451, nz: 351 };
const grid = new Float32Array(G.nx * G.nz);
for (let j = 0; j < G.nz; j++) for (let i = 0; i < G.nx; i++) grid[j * G.nx + i] = heightAt(G.x0 + i * G.step, G.z0 + j * G.step);
function heightFast(x, z) {
  const fx = (x - G.x0) / G.step, fz = (z - G.z0) / G.step, i = Math.floor(fx), j = Math.floor(fz);
  if (i < 0 || j < 0 || i >= G.nx - 1 || j >= G.nz - 1) return heightAt(x, z);
  const u = fx - i, v = fz - j, k = j * G.nx + i;
  return (grid[k] * (1 - u) + grid[k + 1] * u) * (1 - v) + (grid[k + G.nx] * (1 - u) + grid[k + G.nx + 1] * u) * v;
}
export function groundY(x, z) {
  for (const p of PIERS) if (Math.abs(x - p.x) < 3.2 && z > p.z0 && z < p.z1) return 0.55;
  if (Math.hypot(x - BRIDGE.x, z - BRIDGE.z) < BRIDGE.r) return Math.max(heightFast(x, z), 0.35);
  return heightFast(x, z);
}
const _n = new THREE.Vector3();
export function groundAt(x, z) {
  const y = groundY(x, z), e = 0.6;
  _n.set(groundY(x - e, z) - groundY(x + e, z), 2 * e, groundY(x, z - e) - groundY(x, z + e)).normalize();
  return { y, normal: _n.clone() };
}

// ------------------------------------------------------------------ renderer, scene, camera, bloom
export const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);
export const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x9cc4e4, 160, 520);
export const camera = new THREE.PerspectiveCamera(46, 1, 0.3, 2400);
camera.position.set(110, 70, 140);
export const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
export const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.6, 0.86);
composer.addPass(bloom);
composer.addPass(new OutputPass());
function resize() {
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

// ------------------------------------------------------------------ clock
export const T = { sim: 0, real: 0, speed: 1 };
export const hourNow = () => (START_HOUR + T.sim / DAY * 24) % 24;
export const dayNow = () => Math.floor((START_HOUR / 24 * DAY + T.sim) / DAY) + 1;
export const inH = (h, a, b) => a <= b ? (h >= a && h < b) : (h >= a || h < b);
export function clockText(h) { const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
  return `${(hh % 12) || 12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'am' : 'pm'}`; }
export const dayPart = h => inH(h, 5, 8) ? 'Early morning' : inH(h, 8, 12) ? 'Morning' : inH(h, 12, 17) ? 'Afternoon' : inH(h, 17, 20.5) ? 'Evening' : 'Night';

// ------------------------------------------------------------------ log, caption, spotlight requests
const logEl = document.getElementById('log');
export function log(text) {
  const d = document.createElement('div');
  d.innerHTML = `<b>${clockText(hourNow())}</b>${text}`;
  logEl.appendChild(d);
  while (logEl.children.length > 6) logEl.firstChild.remove();
  setTimeout(() => { d.style.opacity = '0'; setTimeout(() => d.remove(), 1000); }, 28000);
}
const capEl = document.getElementById('caption');
let capText = '';
export function caption(t, sub = '') { const full = sub + '|' + t; if (full === capText) return; capText = full;
  capEl.style.opacity = 0; setTimeout(() => { capEl.innerHTML = (sub ? `<small>${sub}</small>` : '') + t; capEl.style.opacity = 1; }, 150); }
export const director = { spotlight: null };
export function shout(subject, sub, text, secs = 16, kind) { director.spotlight = { subject, sub, text, until: T.real + secs, fresh: true, kind }; }

// ------------------------------------------------------------------ model loading
const modCache = new Map(), protos = new Map();
const load = { total: 0, done: 0 };
const loadBar = document.getElementById('loadBar'), loadText = document.getElementById('loadText');
export const jobs = [];
export function job(fn) {
  load.total++;
  const p = (async () => { try { await fn(); } catch (e) { console.warn('load failed', e); }
    load.done++; loadBar.style.width = (100 * load.done / Math.max(1, load.total)) + '%';
    loadText.textContent = `Building Saltmeadow... ${load.done} of ${load.total}`; })();
  jobs.push(p); return p;
}
export const mod = id => { if (!modCache.has(id)) modCache.set(id, import(CDN + id + '.mjs')); return modCache.get(id); };
export async function make(id, fresh = false, params) {
  const m = await mod(id);
  let o;
  if (fresh || params) o = m.createAsset(params);
  else { if (!protos.has(id)) protos.set(id, m.createAsset()); o = protos.get(id).clone(); }
  o.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
  return o;
}
export async function proto(id) { await make(id); return protos.get(id); }

// things the planting code keeps clear of: [x, z, r]
export const CLEAR = [];
export const placed = {};
export const BUILDINGS = [];
export function place(id, x, z, { ry = 0, s = 1, name, faceTo, clear = 0, house = false, y } = {}) {
  if (clear) CLEAR.push([x, z, clear]);
  return job(async () => {
    const o = await make(id);
    o.position.set(x, y ?? groundY(x, z), z);
    o.rotation.y = faceTo ? faceYaw(x, z, faceTo[0], faceTo[1]) : ry;
    o.scale.setScalar(s);
    scene.add(o);
    if (name) placed[name] = o;
    if (house) BUILDINGS.push(o);
    return o;
  });
}

// many copies of one model as instanced meshes: transforms = [[x, z, yaw, scale], ...]
export function plant(id, transforms, { shadow = true, sink = 0 } = {}) {
  if (!transforms.length) return;
  return job(async () => {
    const p = await proto(id);
    p.updateMatrixWorld(true);
    const meshes = []; p.traverse(m => { if (m.isMesh) meshes.push(m); });
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    // one instanced mesh per 90 m square, so squares off screen (and outside the sun's shadow box) are skipped
    const cells = new Map();
    for (const t of transforms) { const k = Math.floor(t[0] / 90) + ',' + Math.floor(t[1] / 90); (cells.get(k) || cells.set(k, []).get(k)).push(t); }
    for (const list of cells.values()) for (const m of meshes) {
      const im = new THREE.InstancedMesh(m.geometry, m.material, list.length);
      list.forEach(([x, z, yaw, s, y], i) => {
        M.compose(V(x, z, y ?? groundY(x, z) - sink), q.setFromAxisAngle(up, yaw), new THREE.Vector3(s, s, s));
        im.setMatrixAt(i, M.clone().multiply(m.matrixWorld));
      });
      im.castShadow = shadow; im.receiveShadow = true;
      im.computeBoundingSphere();
      scene.add(im);
    }
  });
}

// soft round glow for lamps, fires, fireworks
export const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, '#fff6d0'); g.addColorStop(0.25, '#ffcf6aaa'); g.addColorStop(1, '#ff9a3000');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
export function glow(size, color = 0xffffff) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
  s.scale.setScalar(size); return s;
}
export const puffTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, '#ffffffcc'); g.addColorStop(0.6, '#ffffff55'); g.addColorStop(1, '#ffffff00');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();

// one pool of smoke puffs for chimneys, cannons and the bonfire
const PUFFS = [];
for (let i = 0; i < 260; i++) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, color: 0xdddddd, transparent: true, opacity: 0, depthWrite: false }));
  s.visible = false; s.userData = { life: 0 }; scene.add(s); PUFFS.push(s);
}
let puffNext = 0;
export function puff(pos, { size = 1.5, grow = 1.2, rise = 1.2, life = 5, color = 0xdddddd, opacity = 0.55, drift = 0.6 } = {}) {
  const s = PUFFS[puffNext = (puffNext + 1) % PUFFS.length];
  s.position.copy(pos); s.visible = true; s.material.color.set(color);
  s.userData = { life, age: 0, size, grow, rise, opacity, drift: drift * (0.5 + Math.random()) };
}
export function updatePuffs(dt) {
  for (const s of PUFFS) {
    if (!s.visible) continue;
    const u = s.userData; u.age += dt;
    if (u.age >= u.life) { s.visible = false; continue; }
    const t = u.age / u.life;
    s.position.y += u.rise * dt; s.position.x += u.drift * dt;
    s.scale.setScalar(u.size * (1 + t * u.grow * 3));
    s.material.opacity = u.opacity * Math.min(1, t * 6) * (1 - t);
  }
}

// Model Lab: look at our characters, swap every part, recolor, put a tool in the hand and play any animation.
// The same steps the game's Looks screen takes; character.js does the work.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { Library, Character, SLOTS, COLORS, catalogFromFiles } from './character.js';

const HEIGHT = 1.8;
const REFERENCE = ['Knight', 'Barbarian', 'Mage', 'Ranger', 'Rogue', 'Rogue_Hooded'];

const qs = new URLSearchParams(location.search);
const state = {
  preset: qs.get('preset') || 'islander',
  anim: qs.get('anim') || 'Idle_A',
  tool: qs.get('tool') || '',
  view: ['play', 'close', 'lineup'].includes(qs.get('view')) ? qs.get('view') : 'close',
  speed: Number(qs.get('speed')) || 1,
  ref: qs.get('ref') || '',
};
function saveState() {
  const p = new URLSearchParams();
  for (const k of ['preset', 'anim', 'tool', 'view', 'ref']) if (state[k]) p.set(k, state[k]);
  if (state.speed !== 1) p.set('speed', state.speed);
  history.replaceState(null, '', '?' + p.toString());
}

// ---------- three.js scene ----------
const stage = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.prepend(renderer.domElement);

const SKY = new THREE.Color('#b7d6e4');
const scene = new THREE.Scene();
scene.background = SKY;
scene.fog = new THREE.Fog(SKY, 22, 48);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;

const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 1.5;
controls.maxDistance = 30;

scene.add(new THREE.HemisphereLight(0xffffff, 0x6f9470, 1.0));
const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
sun.position.set(4, 9, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 30 });
sun.shadow.bias = -0.0004;
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(40, 64).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: '#6f9f72', roughness: 1, metalness: 0 }),
);
ground.receiveShadow = true;
scene.add(ground);

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);

// ---------- characters ----------
const $ = (id) => document.getElementById(id);
let lib = null;
let actors = [];        // { kind: 'ours', c, label } or { kind: 'ref', holder, mixer, bones, label }
let look = null;        // the appearance being edited (single view)
let token = 0;

const clone = (o) => JSON.parse(JSON.stringify(o));
const presetById = (id) => lib.catalog.presets.find((p) => p.id === id) || lib.catalog.presets[0];

function setError(msg) { $('err').hidden = !msg; $('err').textContent = msg || ''; }

async function buildRef(name) {
  const gltf = await new GLTFLoader().loadAsync(`reference/kaykit/${name}.glb`);
  const root = SkeletonUtils.clone(gltf.scene);
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  const holder = new THREE.Group();
  holder.add(root);
  holder.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(holder);
  const s = HEIGHT / (box.max.y - box.min.y);
  holder.scale.setScalar(s);
  holder.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(holder);
  root.position.y -= box.min.y / s;
  const bones = new Set();
  root.traverse((o) => { if (o.isBone) bones.add(o.name); });
  return { kind: 'ref', holder, mixer: new THREE.AnimationMixer(root), bones, label: name.replace('_', ' '), action: null, name };
}

async function rebuild() {
  const mine = ++token;
  setError('');
  try {
    let built;
    if (state.ref) {
      built = [await buildRef(state.ref)];
    } else if (state.view === 'lineup') {
      built = await Promise.all(lib.catalog.presets.map(async (p) => {
        const c = await Character.create(lib, clone(p.appearance));
        c.setHeight(HEIGHT);
        if (state.tool) await c.setTool(state.tool);
        return { kind: 'ours', c, label: p.name };
      }));
    } else {
      look = look && look.preset === state.preset ? look : { preset: state.preset, ...clone(presetById(state.preset).appearance) };
      if (state.tool) look.tool = state.tool;
      const c = await Character.create(lib, look);
      c.setHeight(HEIGHT);
      built = [{ kind: 'ours', c, label: presetById(state.preset).name }];
    }
    if (mine !== token) return;
    for (const a of actors) { if (a.kind === 'ours') a.c.dispose(); else scene.remove(a.holder); }
    actors = built;
    const gap = 1.7;
    actors.forEach((a, i) => {
      const holder = a.kind === 'ours' ? a.c.holder : a.holder;
      holder.position.x = (i - (actors.length - 1) / 2) * gap;
      scene.add(holder);
    });
    await playAll(state.anim);
    frameCamera();
    renderUi();
    saveState();
  } catch (e) {
    console.error(e);
    setError('Could not load: ' + (e && e.message ? e.message : e));
  }
}

async function playAll(name) {
  state.anim = name;
  const clips = await lib.clips();
  for (const a of actors) {
    if (a.kind === 'ours') { await a.c.playClip(name, { fade: 0.25 }); continue; }
    const entry = clips.get(name);
    if (!entry) continue;
    const tracks = entry.clip.tracks.filter((t) => a.bones.has(t.name.split('.')[0]));
    const next = a.mixer.clipAction(new THREE.AnimationClip(name, entry.clip.duration, tracks));
    next.reset().play();
    if (a.action && a.action !== next) next.crossFadeFrom(a.action, 0.25, false);
    a.action = next;
  }
  saveState();
}

function frameCamera() {
  const n = actors.length;
  const half = Math.max(1, (n - 1) / 2 * 1.7 + 1);
  if (state.view === 'close' || state.ref) {
    camera.position.set(0, 1.25, 3.7);
    controls.target.set(0, 0.95, 0);
  } else if (state.view === 'lineup') {
    camera.position.set(0, 2.6 + half * 0.35, half * 3.3 + 3);
    controls.target.set(0, 0.8, 0);
  } else { // the high view the games use
    camera.position.set(0, 7.2, 8.2);
    controls.target.set(0, 0.8, 0);
  }
  controls.update();
}

// ---------- the panel ----------
function chip(label, pressed, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip';
  b.textContent = label;
  b.setAttribute('aria-pressed', pressed ? 'true' : 'false');
  b.addEventListener('click', onClick);
  return b;
}

function visibleTris(c) {
  let tris = 0;
  c.holder.traverse((o) => {
    if (!o.isMesh) return;
    for (let p = o; p; p = p.parent) if (!p.visible) return;
    const g = o.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });
  return Math.round(tris);
}

function renderUi() {
  const single = actors.length === 1 && actors[0].kind === 'ours' ? actors[0].c : null;
  const lineup = state.view === 'lineup' && !state.ref;

  $('presets').replaceChildren(...lib.catalog.presets.map((p) => chip(p.name, !lineup && !state.ref && p.id === state.preset, () => {
    state.preset = p.id; state.ref = ''; look = null;
    if (state.view === 'lineup') state.view = 'close';
    rebuild();
  })));

  // parts, one row per slot
  $('slots').replaceChildren(...SLOTS.map((s) => {
    const row = document.createElement('div');
    row.className = 'slot';
    const label = document.createElement('b');
    label.textContent = s.label;
    const chips = document.createElement('div');
    chips.className = 'chips';
    const cur = single ? single.parts[s.id] || '' : '';
    chips.append(chip('None', single && !cur, async () => { if (!single) return; await single.setPart(s.id, null); look.parts = single.appearance().parts; renderUi(); }));
    for (const p of lib.partsFor(s.id)) {
      chips.append(chip(p.name, cur === p.id, async () => {
        if (!single) return;
        await single.setPart(s.id, p.id);
        look.parts = single.appearance().parts;
        renderUi();
      }));
    }
    row.append(label, chips);
    row.hidden = !single;
    return row;
  }));

  // colors: only the ones the worn parts use
  const used = new Set();
  if (single) for (const [k] of COLORS) if (single.colorOf(k)) used.add(k);
  $('colors').replaceChildren(...COLORS.filter(([k]) => used.has(k)).map(([k, label]) => {
    const l = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'color';
    input.value = single.colorOf(k);
    input.addEventListener('input', () => { single.setColor(k, input.value); look.colors = single.appearance().colors; });
    l.append(input, label);
    return l;
  }));

  $('tools').replaceChildren(
    chip('None', !state.tool, async () => { state.tool = ''; if (look) look.tool = null; for (const a of actors) if (a.kind === 'ours') await a.c.setTool(null); renderUi(); saveState(); }),
    ...lib.catalog.tools.map((t) => chip(t.name, state.tool === t.id, async () => {
      state.tool = t.id; if (look) look.tool = t.id;
      for (const a of actors) if (a.kind === 'ours') await a.c.setTool(t.id);
      renderUi(); saveState();
    })),
  );

  $('roles').replaceChildren(...Object.keys(lib.catalog.roles).map((r) => {
    const rr = lib.role(r);
    return chip(r.replace('_', ' '), rr.clip === state.anim, async () => { await playAll(rr.clip); renderUi(); });
  }));
  lib.clips().then((clips) => {
    const groups = [...new Set([...clips.values()].map((e) => e.group))];
    $('anims').replaceChildren(...groups.map((g) => {
      const wrap = document.createElement('div');
      wrap.className = 'group';
      const h = document.createElement('h3');
      h.textContent = g;
      const row = document.createElement('div');
      row.className = 'chips';
      row.append(...[...clips.entries()].filter(([, e]) => e.group === g).map(([name]) =>
        chip(name.replace(/_/g, ' '), name === state.anim, async () => { await playAll(name); renderUi(); })));
      wrap.append(h, row);
      return wrap;
    }));
  });

  $('views').replaceChildren(...[['play', 'Play view'], ['close', 'Close'], ['lineup', 'Lineup']].map(([v, label]) => chip(label, v === state.view && !state.ref, () => {
    state.ref = '';
    const rebuildNeeded = v === 'lineup' || state.view === 'lineup';
    state.view = v;
    if (rebuildNeeded) rebuild(); else { frameCamera(); renderUi(); saveState(); }
  })));

  $('title').textContent = state.ref ? `Reference: ${state.ref.replace('_', ' ')} (not ours)` : lineup ? `Our characters: all ${actors.length}` : `Ours: ${actors[0] ? actors[0].label : ''}`;
  $('stats').textContent = (single ? `${visibleTris(single).toLocaleString()} triangles drawn, ` : '') + `playing ${state.anim.replace(/_/g, ' ')}.`;
}

$('speed').value = state.speed;
$('speed').addEventListener('input', (e) => { state.speed = Number(e.target.value); saveState(); });

// references (KayKit's classic characters) exist only on this PC, never in the published site
async function offerReference() {
  if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
  const have = [];
  for (const n of REFERENCE) {
    try { if ((await fetch(`reference/kaykit/${n}.glb`, { method: 'HEAD' })).ok) have.push(n); } catch { /* none */ }
  }
  if (!have.length) return;
  $('refSec').hidden = false;
  $('refs').replaceChildren(...have.map((n) => chip(n.replace('_', ' '), state.ref === n, () => { state.ref = state.ref === n ? '' : n; rebuild(); })));
}

// ---------- loop ----------
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta() * state.speed;
  for (const a of actors) (a.kind === 'ours' ? a.c : a).mixer.update(dt);
  controls.update();
  renderer.render(scene, camera);
});

resize();
try {
  lib = new Library(await catalogFromFiles(location.pathname.replace(/[^/]*$/, '')));
  await rebuild();
  offerReference();
} catch (e) {
  console.error(e);
  setError('Could not start: ' + (e && e.message ? e.message : e));
}
window.__lab = { state, scene, get actors() { return actors; }, camera, controls, get lib() { return lib; } }; // handy in the console

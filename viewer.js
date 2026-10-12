// Model Lab viewer: look at the free characters and their animations in Three.js.
// One rig per pack, so every animation of a pack plays on every character of that pack
// with no retargeting: the clips find their bones by name.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const Q = 'library/quaternius/';
const K = 'library/kaykit/';
const HAIR_COLORS = { Black: '#1c1815', Brown: '#5b3a22', Blond: '#c9a25a', Red: '#8a3a1e', Gray: '#9a9a9a', White: '#e8e4dc' };
const HEIGHT = 1.8; // every character is scaled to this height so packs compare fairly

const PACKS = {
  quaternius: {
    name: 'Quaternius',
    blurb: 'Realistic-stylized. 65 bones with fingers, about 14,000 triangles, PBR textures.',
    characters: [
      { id: 'sh_m', label: 'Superhero M', file: Q + 'characters/Superhero_Male.glb', hair: true, defaultHair: 'Hair_Buzzed' },
      { id: 'sh_f', label: 'Superhero F', file: Q + 'characters/Superhero_Female.glb', hair: true, defaultHair: 'Hair_Buns' },
      { id: 'pea_m', label: 'Peasant M', file: Q + 'outfits/Male_Peasant.glb', head: 'Head_Male', hair: true, defaultHair: 'Hair_SimpleParted' },
      { id: 'pea_f', label: 'Peasant F', file: Q + 'outfits/Female_Peasant.glb', head: 'Head_Female', hair: true, defaultHair: 'Hair_Long' },
      { id: 'ran_m', label: 'Ranger M', file: Q + 'outfits/Male_Ranger.glb', head: 'Head_Male' },
      { id: 'ran_f', label: 'Ranger F', file: Q + 'outfits/Female_Ranger.glb', head: 'Head_Female' },
    ],
    hair: ['Hair_Buns', 'Hair_Long', 'Hair_SimpleParted', 'Hair_Buzzed', 'Hair_BuzzedFemale', 'Hair_Beard'],
    hairDir: Q + 'hair/',
    headDir: Q + 'heads/',
    animFiles: [{ group: 'Universal Animation Library', file: Q + 'animations/UAL_Standard.glb' }],
    defaultAnim: 'Idle_Loop',
  },
  kaykit: {
    name: 'KayKit',
    blurb: 'Stylized low-poly. 23 bones, about 6,000 triangles, one tiny palette texture.',
    characters: [
      ...['Knight', 'Barbarian', 'Mage', 'Ranger', 'Rogue', 'Rogue_Hooded']
        .map((n) => ({ id: n.toLowerCase(), label: n.replace('_', ' '), file: K + `characters/${n}.glb` })),
      // ours: built by tools/bl_make_character.py on the same skeleton, so every KayKit animation plays on them
      ...['Islander', 'Farmer', 'Angler', 'Cook', 'Smith'].map((n) => ({ id: n.toLowerCase(), label: n + ' (ours)', ours: true, file: `library/ours/characters/${n}.glb` })),
    ],
    animFiles: ['General', 'MovementBasic', 'MovementAdvanced', 'CombatMelee', 'CombatRanged', 'Simulation', 'Special', 'Tools']
      .map((n) => ({ group: n.replace(/([a-z])([A-Z])/g, '$1 $2'), file: K + `animations/Rig_Medium_${n}.glb` })),
    defaultAnim: 'Idle_A',
  },
};

// ---------- state (mirrored into the address bar so a view can be linked) ----------
const qs = new URLSearchParams(location.search);
const state = {
  pack: PACKS[qs.get('pack')] ? qs.get('pack') : 'quaternius',
  char: qs.get('char') || '',
  hair: qs.get('hair'), // null = each character's own default, 'none' = bare head
  anim: qs.get('anim') || '',
  view: ['play', 'close', 'lineup'].includes(qs.get('view')) ? qs.get('view') : 'play',
  hairColor: HAIR_COLORS[qs.get('hc')] ? qs.get('hc') : 'Brown',
  speed: Number(qs.get('speed')) || 1,
};
const hairFor = (a) => (state.hair === null ? a.def.defaultHair || '' : state.hair === 'none' ? '' : state.hair);
function saveState() {
  const p = new URLSearchParams();
  for (const k of ['pack', 'char', 'hair', 'anim', 'view']) if (state[k]) p.set(k, state[k]);
  if (state.hairColor !== 'Brown') p.set('hc', state.hairColor);
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

// ---------- loading ----------
const loader = new GLTFLoader();
const cache = new Map();
const loadGLB = (url) => {
  if (!cache.has(url)) cache.set(url, loader.loadAsync(url));
  return cache.get(url);
};

let animEntries = []; // { name, group, clip } for the current pack
async function loadAnimations(pack) {
  const out = [];
  const seen = new Set();
  const files = await Promise.all(pack.animFiles.map(async (f) => ({ ...f, gltf: await loadGLB(f.file) })));
  for (const f of files) {
    for (const clip of f.gltf.animations) {
      if (seen.has(clip.name)) continue; // KayKit repeats T-Pose in every file
      seen.add(clip.name);
      out.push({ name: clip.name, group: f.group, clip });
    }
  }
  return out;
}

function countTris(root) {
  let tris = 0, bones = 0;
  root.traverse((o) => {
    if (o.isMesh) {
      const g = o.geometry;
      tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
      if (o.isSkinnedMesh) bones = Math.max(bones, o.skeleton.bones.length);
    }
  });
  return { tris: Math.round(tris), bones };
}

async function buildActor(def) {
  const gltf = await loadGLB(def.file);
  const root = SkeletonUtils.clone(gltf.scene);
  root.traverse((o) => {
    if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; }
  });
  const holder = new THREE.Group();
  holder.add(root);
  // stand on the ground at a common height
  holder.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(holder);
  const s = HEIGHT / (box.max.y - box.min.y);
  holder.scale.setScalar(s);
  holder.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(holder);
  root.position.y -= box.min.y / s;
  // ours: give each character its own materials so recoloring one does not change the others
  let mats = null;
  if (def.ours) {
    mats = {};
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.material = o.material.clone();
      (mats[o.material.name] ||= []).push(o.material);
    });
  }
  const boneNames = new Set();
  let skeleton = null;
  root.traverse((o) => {
    if (o.isBone) boneNames.add(o.name);
    if (o.isSkinnedMesh && !skeleton) skeleton = o.skeleton;
  });
  return {
    def, holder, root, skeleton, boneNames,
    mixer: new THREE.AnimationMixer(root),
    clips: new Map(), action: null, hair: [], info: countTris(root), mats,
  };
}

// Hair and heads are skinned to the same 65-bone skeleton as the body: rebuild each part's skeleton from
// this character's own bones, so the part moves with every animation.
async function attachParts(actor, url, tint) {
  const g = await loadGLB(url);
  g.scene.updateMatrixWorld(true);
  const made = [];
  g.scene.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const bones = o.skeleton.bones.map((b) => actor.skeleton.getBoneByName(b.name) || actor.skeleton.bones[0]);
    const mat = tint ? o.material.clone() : o.material;
    if (tint) mat.color.set(tint);
    const mesh = new THREE.SkinnedMesh(o.geometry, mat);
    mesh.bind(new THREE.Skeleton(bones, o.skeleton.boneInverses), o.bindMatrix);
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    actor.root.add(mesh);
    made.push(mesh);
  });
  return made;
}

async function setHair(actor, pack, name) {
  for (const m of actor.hair) m.removeFromParent();
  actor.hair = [];
  if (!name || !actor.def.hair || !pack.hairDir) return;
  actor.hair = await attachParts(actor, `${pack.hairDir}${name}.glb`, HAIR_COLORS[state.hairColor]);
}

// the free outfit pieces come without a head: give them one cut from the base character
async function setHead(actor, pack) {
  if (!actor.def.head || !pack.headDir) return;
  await attachParts(actor, `${pack.headDir}${actor.def.head}.glb`);
}

// a clip keeps only the tracks whose bone this character has (finger-tip bones differ between exports)
function clipFor(actor, entry) {
  let c = actor.clips.get(entry.name);
  if (!c) {
    const tracks = entry.clip.tracks.filter((t) => actor.boneNames.has(t.name.split('.')[0]));
    c = new THREE.AnimationClip(entry.name, entry.clip.duration, tracks);
    actor.clips.set(entry.name, c);
  }
  return c;
}

// ---------- the stage ----------
let actors = [];
let token = 0; // ignores a slow load that a newer click has replaced
const $ = (id) => document.getElementById(id);

function setError(msg) {
  $('err').hidden = !msg;
  $('err').textContent = msg || '';
}

async function rebuild() {
  const mine = ++token;
  const pack = PACKS[state.pack];
  setError('');
  $('stats').textContent = 'Loading...';
  try {
    animEntries = await loadAnimations(pack);
    if (mine !== token) return;
    if (!pack.characters.some((c) => c.id === state.char)) state.char = pack.characters[0].id;
    if (!animEntries.some((a) => a.name === state.anim)) {
      state.anim = animEntries.some((a) => a.name === pack.defaultAnim) ? pack.defaultAnim : animEntries[0].name;
    }
    const defs = state.view === 'lineup' ? pack.characters : [pack.characters.find((c) => c.id === state.char)];
    const built = await Promise.all(defs.map(buildActor));
    if (mine !== token) return;
    for (const a of actors) { a.mixer.stopAllAction(); scene.remove(a.holder); }
    actors = built;
    const gap = 1.7;
    actors.forEach((a, i) => { a.holder.position.x = (i - (actors.length - 1) / 2) * gap; scene.add(a.holder); });
    for (const a of actors) { await setHead(a, pack); await setHair(a, pack, hairFor(a)); }
    if (mine !== token) return;
    playAll(state.anim, 0);
    frameCamera();
    renderUi();
    saveState();
  } catch (e) {
    console.error(e);
    setError('Could not load: ' + (e && e.message ? e.message : e));
  }
}

function playAll(name, fade = 0.25) {
  state.anim = name;
  const entry = animEntries.find((a) => a.name === name);
  if (!entry) return;
  for (const a of actors) {
    const next = a.mixer.clipAction(clipFor(a, entry));
    next.reset().play();
    if (a.action && a.action !== next) next.crossFadeFrom(a.action, fade, false);
    a.action = next;
  }
  saveState();
}

function frameCamera() {
  const n = actors.length;
  const half = Math.max(1, (n - 1) / 2 * 1.7 + 1);
  if (state.view === 'close') {
    camera.position.set(0, 1.25, 3.7);
    controls.target.set(0, 0.95, 0);
  } else if (state.view === 'lineup') {
    camera.position.set(0, 2.6 + half * 0.35, half * 3.3 + 3);
    controls.target.set(0, 0.8, 0);
  } else { // the high view the games use: small figure, looking down at about 45 degrees
    camera.position.set(0, 7.2, 8.2);
    controls.target.set(0, 0.8, 0);
  }
  controls.update();
}

// ---------- panel ----------
function chip(label, pressed, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip';
  b.textContent = label;
  b.setAttribute('aria-pressed', pressed ? 'true' : 'false');
  b.addEventListener('click', onClick);
  return b;
}

function renderUi() {
  const pack = PACKS[state.pack];
  const packs = $('packs');
  packs.replaceChildren(...Object.entries(PACKS).map(([key, p]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pack';
    b.setAttribute('aria-pressed', key === state.pack ? 'true' : 'false');
    b.innerHTML = `<b></b><span></span>`;
    b.querySelector('b').textContent = p.name;
    b.querySelector('span').textContent = p.blurb;
    b.addEventListener('click', () => {
      if (key === state.pack) return;
      state.pack = key; state.char = ''; state.anim = ''; state.hair = null;
      rebuild();
    });
    return b;
  }));

  $('chars').replaceChildren(...pack.characters.map((c) =>
    chip(c.label, state.view !== 'lineup' && c.id === state.char, () => {
      state.char = c.id;
      state.hair = null;
      if (state.view === 'lineup') state.view = 'play';
      rebuild();
    })));

  const showHair = !!pack.hair && state.view !== 'lineup' && !!pack.characters.find((c) => c.id === state.char)?.hair;
  $('hairSec').hidden = !showHair;
  if (showHair) {
    $('hairColor').replaceChildren(...Object.keys(HAIR_COLORS).map((c) =>
      chip(c, c === state.hairColor, () => {
        state.hairColor = c;
        for (const a of actors) for (const m of a.hair) m.material.color.set(HAIR_COLORS[c]);
        renderUi(); saveState();
      })));
    const shown = hairFor(actors[0]);
    $('hair').replaceChildren(...['', ...pack.hair].map((h) =>
      chip(h ? h.replace('Hair_', '') : 'None', h === shown, async () => {
        state.hair = h || 'none';
        for (const a of actors) await setHair(a, pack, hairFor(a));
        renderUi(); saveState();
      })));
  }

  const groups = [...new Set(animEntries.map((a) => a.group))];
  $('anims').replaceChildren(...groups.map((g) => {
    const wrap = document.createElement('div');
    wrap.className = 'group';
    const h = document.createElement('h3');
    h.textContent = g;
    const row = document.createElement('div');
    row.className = 'chips';
    row.append(...animEntries.filter((a) => a.group === g).map((a) =>
      chip(a.name.replace(/_/g, ' '), a.name === state.anim, () => { playAll(a.name); renderUi(); })));
    wrap.append(h, row);
    return wrap;
  }));

  const views = [['play', 'Play view'], ['close', 'Close'], ['lineup', 'Lineup']];
  $('views').replaceChildren(...views.map(([v, label]) => chip(label, v === state.view, () => {
    if (v === state.view) return;
    const needsRebuild = v === 'lineup' || state.view === 'lineup';
    state.view = v;
    if (needsRebuild) rebuild(); else { frameCamera(); renderUi(); saveState(); }
  })));

  const cur0 = actors.length === 1 ? actors[0] : null;
  $('colorSec').hidden = !(cur0 && cur0.mats);
  if (cur0 && cur0.mats) {
    const order = ['skin', 'hair', 'shirt', 'trousers', 'boots', 'belt', 'linen', 'eyes', 'mouth', 'eyeshine'];
    $('colors').replaceChildren(...order.filter((n) => cur0.mats[n]).map((n) => {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'color';
      input.value = '#' + cur0.mats[n][0].color.getHexString();
      input.addEventListener('input', () => cur0.mats[n].forEach((m) => m.color.set(input.value)));
      label.append(input, n === 'eyeshine' ? 'eye shine' : n);
      return label;
    }));
  }
  const cur = actors.length === 1 ? actors[0] : null;
  $('title').textContent = cur ? `${pack.name}: ${cur.def.label}` : `${pack.name}: all ${actors.length} characters`;
  $('stats').textContent = (cur ? `${cur.info.tris.toLocaleString()} triangles, ${cur.info.bones} bones, ` : '')
    + `${animEntries.length} animations on this rig. Playing ${state.anim.replace(/_/g, ' ')}.`;
}

$('speed').value = state.speed;
$('speed').addEventListener('input', (e) => { state.speed = Number(e.target.value); saveState(); });

// ---------- loop ----------
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta() * state.speed;
  for (const a of actors) a.mixer.update(dt);
  controls.update();
  renderer.render(scene, camera);
});

resize();
rebuild();
window.__lab = { state, get actors() { return actors; }, camera, controls, PACKS }; // handy in the console

// Assembles our characters from the body kit and plays animations on them. No DOM in here: the lab, the game's Looks
// screen and the admin pages all use this one file (the game keeps a copy, see tools/sync-to-wayfarer.ps1).
//
// A character is the bare Body plus one part per slot (hair, hat, top...), each skinned to the same skeleton:
//   const lib = new Library(catalog);
//   const c = await Character.create(lib, { parts: { hair: 'hair_short', top: 'top_tee' }, colors: { shirt: '#3f7ca8' }, tool: 'axe' });
//   scene.add(c.holder);  c.playRole('walk');  each frame: c.update(dt)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

export const SLOTS = [
  { id: 'hair', label: 'Hair' }, { id: 'beard', label: 'Beard' }, { id: 'hat', label: 'Hat' },
  { id: 'top', label: 'Top' }, { id: 'bottom', label: 'Bottom' }, { id: 'boots', label: 'Boots' }, { id: 'back', label: 'Back' },
];
/** The colors a player can change: the material name in the models, and what to call it. */
export const COLORS = [
  ['skin', 'Skin'], ['hair', 'Hair'], ['shirt', 'Top'], ['trousers', 'Bottom'], ['boots', 'Boots'], ['belt', 'Belt'],
  ['linen', 'Trim'], ['hat', 'Hat'], ['hatband', 'Hat band'], ['pack', 'Backpack'], ['eyes', 'Eyes'], ['mouth', 'Mouth'],
];
/** Feet to the top of the head, in the models' own units (scale a character to the height you want). */
export const CHARACTER_HEIGHT = 2.32;
export const DEFAULT_APPEARANCE = {
  parts: { hair: 'hair_short', top: 'top_tee', bottom: 'bottom_trousers', boots: 'boots_tall' },
  colors: {},
  tool: null,
};

const join = (base, url) => (/^(https?:)?\/\//.test(url) || url.startsWith('/') || !base ? url : base.replace(/\/?$/, '/') + url);

/** Everything that can be loaded, from a catalog (see catalogFromFiles; the game builds the same shape from the database). */
export class Library {
  constructor(catalog, loader = new GLTFLoader()) {
    this.catalog = catalog;
    this.loader = loader;
    this._glb = new Map();
    this._clips = null;
  }
  url(u) { return join(this.catalog.baseUrl || '', u); }
  glb(url) {
    if (!this._glb.has(url)) this._glb.set(url, this.loader.loadAsync(this.url(url)));
    return this._glb.get(url);
  }
  part(id) { return this.catalog.parts.find((p) => p.id === id) || null; }
  tool(id) { return this.catalog.tools.find((t) => t.id === id) || null; }
  partsFor(slot) { return this.catalog.parts.filter((p) => p.slot === slot && p.enabled !== false); }
  /** All animation clips by name: Map(name -> { clip, group }). */
  clips() {
    if (!this._clips) {
      this._clips = (async () => {
        const out = new Map();
        const files = await Promise.all(this.catalog.animations.map(async (f) => ({ f, g: await this.glb(f.url) })));
        for (const { f, g } of files) {
          for (const clip of g.animations) if (!out.has(clip.name)) out.set(clip.name, { clip, group: f.group });
        }
        return out;
      })();
    }
    return this._clips;
  }
  /** A role ('walk', 'chop'...) as { clip, loop } from the catalog's role table. */
  role(name) {
    const r = (this.catalog.roles && this.catalog.roles[name]) || BUILT_IN_ROLES[name];
    if (!r) return null;
    return typeof r === 'string' ? { clip: r, loop: true } : { loop: true, ...r };
  }
}

/** Roles the game needs that an older roles record (in the database) may not have yet; the catalog's own entry wins. */
export const BUILT_IN_ROLES = {
  scoop: 'Digging',   // dipping a net into the water and lifting it
  stir: { clip: 'Stirring', fallback: 'cook' },   // our own clip (Rig_Medium_Ours.glb); until it is in the database, KayKit's cooking pose
};

/** Reads manifest.json + roles.json + presets.json from a folder (the lab, and the game's bundled copy). */
export async function catalogFromFiles(baseUrl) {
  const get = async (u) => (await fetch(join(baseUrl, u))).json();
  const [manifest, anim, presets] = await Promise.all([get('library/ours/manifest.json'), get('library/animations/roles.json'), get('library/ours/presets.json')]);
  return {
    baseUrl,
    base: { url: 'library/ours/' + manifest.body.file },
    parts: manifest.parts.map((p) => ({ ...p, url: 'library/ours/' + p.file, tier: 'free', price: 0, enabled: true })),
    tools: manifest.tools.map((t) => ({ ...t, url: 'library/ours/' + t.file })),
    animations: anim.files.map((f) => ({ ...f, url: 'library/animations/' + f.file })),
    roles: anim.roles,
    presets: presets.presets,
  };
}

/**
 * Builds the same catalog from rows of the `game_models` database collection (see Wayfarer's server/setup-models.mjs):
 * one row per body, part, tool, animation file, preset, plus one 'roles' row. `api` is the PocketBase address; a row's file
 * is served from <api>/api/files/game_models/<id>/<file>. Returns null when the database has no body yet.
 */
export function catalogFromRecords(records, api) {
  const file = (r) => `${api.replace(/\/$/, '')}/api/files/game_models/${r.id}/${r.file}`;
  const on = (kind) => records
    .filter((r) => r.kind === kind && r.enabled !== false && (kind === 'roles' || r.file || kind === 'preset'))
    .sort((a, b) => (a.sort || 0) - (b.sort || 0) || String(a.key).localeCompare(String(b.key)));
  const id = (r, prefix) => (r.data && r.data.id) || String(r.key).replace(prefix, '');
  const body = on('body')[0];
  if (!body) return null;
  return {
    baseUrl: '',
    source: 'database',
    base: { url: file(body) },
    parts: on('part').map((r) => ({
      id: id(r, 'part:'), slot: r.slot, name: r.name, hides: (r.data && r.data.hides) || [], materials: (r.data && r.data.materials) || {},
      tris: r.data && r.data.tris, url: file(r), tier: r.tier || 'free', price: r.price || 0, enabled: true, record: r.id,
    })),
    tools: on('tool').map((r) => ({
      id: id(r, 'tool:'), name: r.name, url: file(r), bone: (r.data && r.data.bone) || 'handslot.r', scale: (r.data && r.data.scale) || 1,
      tier: r.tier || 'free', price: r.price || 0, record: r.id,
    })),
    animations: on('animation').map((r) => ({ id: id(r, 'anim:'), group: (r.data && r.data.group) || r.name, url: file(r), record: r.id })),
    roles: (records.find((r) => r.kind === 'roles' && r.enabled !== false) || {}).data || {},
    presets: on('preset').map((r) => ({ id: id(r, 'preset:'), name: r.name, appearance: (r.data && r.data.appearance) || {}, tier: r.tier || 'free', record: r.id })),
  };
}
const sanitize = (n) => n.replace(/\s/g, '_').replace(/[[\].:/]/g, '');

export class Character {
  static async create(lib, appearance = DEFAULT_APPEARANCE) {
    const c = new Character(lib);
    await c._init();
    await c.apply(appearance);
    return c;
  }

  constructor(lib) {
    this.lib = lib;
    this.holder = new THREE.Group();
    this.parts = {};                // slot -> id
    this.colors = {};               // material name -> hex (overrides only)
    this.tool = null;
    this._slotMeshes = {};          // slot -> [SkinnedMesh]
    this._toolRoot = null;
    this._mats = new Map();         // material name -> Set(Material)
    this._clipCache = new Map();
    this._current = null;
    this._currentName = '';
    this.height = CHARACTER_HEIGHT;
  }

  async _init() {
    const gltf = await this.lib.glb(this.lib.catalog.base.url);
    this.root = SkeletonUtils.clone(gltf.scene);
    this.holder.add(this.root);
    this.bones = new Map();
    this.body = [];
    this.root.traverse((o) => {
      if (o.isBone) this.bones.set(o.name, o);
      if (o.isSkinnedMesh) {
        o.frustumCulled = false;
        o.castShadow = true;
        o.material = this._own(o.material);
        this.body.push(o);
        this.skeleton ||= o.skeleton;
      }
    });
    this.mixer = new THREE.AnimationMixer(this.root);
  }

  /** Give this character its own copy of a material so recoloring never touches another character. */
  _own(material) {
    const m = material.clone();
    m.userData.baseColor = m.color.clone();   // what the part ships with, to go back to
    if (!this._mats.has(m.name)) this._mats.set(m.name, new Set());
    this._mats.get(m.name).add(m);
    if (this.colors[m.name]) m.color.set(this.colors[m.name]);
    return m;
  }
  _release(meshOrGroup) {
    meshOrGroup.traverse?.((o) => {
      if (o.isMesh && o.material) for (const set of this._mats.values()) set.delete(o.material);
      if (o.isMesh && o.material && o.material.dispose) o.material.dispose();
    });
  }

  /** The look as plain data (what the game saves): { parts, colors, tool }. */
  appearance() { return { parts: { ...this.parts }, colors: { ...this.colors }, tool: this.tool }; }

  async apply(a) {
    const next = { ...DEFAULT_APPEARANCE, ...a, parts: { ...(a && a.parts) } };
    for (const k of Object.keys(this.colors)) if (!(next.colors && k in next.colors)) this.setColor(k, null);   // back to each part's own color
    for (const [k, v] of Object.entries(next.colors || {})) this.setColor(k, v);
    const slots = new Set([...SLOTS.map((s) => s.id), ...Object.keys(this.parts)]);
    await Promise.all([...slots].map((s) => this.setPart(s, next.parts[s] || null)));
    await this.setTool(next.tool || null);
    return this;
  }

  setColor(key, hex) {
    if (hex) this.colors[key] = hex; else delete this.colors[key];
    const set = this._mats.get(key);
    if (set) for (const m of set) { if (hex) m.color.set(hex); else if (m.userData.baseColor) m.color.copy(m.userData.baseColor); }
  }

  /** The color a material shows right now (a hex string), for the Looks screen's pickers. */
  colorOf(key) {
    const set = this._mats.get(key);
    if (!set || !set.size) return null;
    return '#' + [...set][0].color.getHexString();
  }

  async setPart(slot, id) {
    if ((this.parts[slot] || null) === (id || null) && (id === null || this._slotMeshes[slot])) return;
    for (const m of this._slotMeshes[slot] || []) { m.removeFromParent(); this._release(m); }
    delete this._slotMeshes[slot];
    if (!id) { delete this.parts[slot]; this._hide(); return; }
    const def = this.lib.part(id);
    if (!def) { console.warn('Unknown part, skipped:', id); delete this.parts[slot]; this._hide(); return; }
    const gltf = await this.lib.glb(def.url);
    if ((this.parts[slot] || null) === id && this._slotMeshes[slot]) return; // a faster call already did it
    const made = [];
    gltf.scene.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      const bones = o.skeleton.bones.map((b) => this.bones.get(b.name) || this.bones.get(sanitize(b.name)) || this.skeleton.bones[0]);
      const mesh = new THREE.SkinnedMesh(o.geometry, this._own(o.material));
      mesh.name = o.name;
      mesh.bind(new THREE.Skeleton(bones, o.skeleton.boneInverses), o.bindMatrix);
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      this.root.add(mesh);
      made.push(mesh);
    });
    this._slotMeshes[slot] = made;
    this.parts[slot] = id;
    this._hide();
  }

  /** Hide the skin regions that the worn parts cover, so nothing is drawn twice. */
  _hide() {
    const hidden = new Set();
    for (const id of Object.values(this.parts)) for (const r of (this.lib.part(id) || {}).hides || []) hidden.add(r);
    for (const m of this.body) if (m.name.startsWith('skin_')) m.visible = !hidden.has(m.name);
  }

  async setTool(id) {
    if (this._toolRoot) { this._toolRoot.removeFromParent(); this._release(this._toolRoot); this._toolRoot = null; }
    this.tool = id || null;
    if (!id) return;
    const def = this.lib.tool(id);
    if (!def) { console.warn('Unknown tool, skipped:', id); this.tool = null; return; }
    const gltf = await this.lib.glb(def.url);
    if (this.tool !== id) return;
    const root = SkeletonUtils.clone(gltf.scene);
    root.scale.setScalar(def.scale || 1);
    root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.material = this._own(o.material); } });
    (this.bones.get(sanitize(def.bone || 'handslot.r')) || this.root).add(root);
    this._toolRoot = root;
  }

  // ---- animation
  clipFor(name, entry) {
    let c = this._clipCache.get(name);
    if (!c) {
      const tracks = entry.clip.tracks.filter((t) => this.bones.has(t.name.split('.')[0]));
      c = new THREE.AnimationClip(name, entry.clip.duration, tracks);
      this._clipCache.set(name, c);
    }
    return c;
  }

  /** Play a clip by name. Does nothing if it is already the one playing. once = play to the end and hold. */
  async playClip(name, { fade = 0.2, once = false, speed = 1, restart = false } = {}) {
    const clips = await this.lib.clips();
    const entry = clips.get(name);
    if (!entry) return false;
    if (this._currentName === name && this._current && !restart) { this._current.timeScale = speed; return true; }
    const next = this.mixer.clipAction(this.clipFor(name, entry));
    next.reset();
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    next.clampWhenFinished = once;
    next.timeScale = speed;
    next.play();
    if (this._current && this._current !== next) next.crossFadeFrom(this._current, fade, false);
    this._current = next;
    this._currentName = name;
    return true;
  }
  /** Play a role from the catalog ('idle', 'walk', 'chop'...). */
  async playRole(role, opts = {}) {
    const r = this.lib.role(role);
    if (!r) return false;
    const ok = await this.playClip(r.clip, { once: r.loop === false, ...opts });
    if (!ok && r.fallback && r.fallback !== role) return this.playRole(r.fallback, opts); // our own clip is not here yet: use the older one
    return ok;
  }
  get playing() { return this._currentName; }

  update(dt) { this.mixer.update(dt); }

  /** Scale so the character is this tall (in the world's units). */
  setHeight(h) { this.holder.scale.setScalar(h / CHARACTER_HEIGHT); }

  dispose() {
    this.holder.removeFromParent();
    this.mixer.stopAllAction();
    this.holder.traverse((o) => { if (o.isMesh && o.material && o.material.dispose) o.material.dispose(); });
    this._mats.clear();
  }
}

// The townsfolk and the animals: who they are, where they go, what they do all day.
import * as THREE from 'three';
import { CDN, scene, camera, T, hourNow, inH, rr, rnd, pick, V, faceYaw, lerpAngle, groundY, groundAt, make, job, glow, log, LAKE, placed } from './core.js';
import { NODES, EDGES, HOMES, FIELD, light } from './world.js';

// ------------------------------------------------------------------ little scripted sequences that wait on the sim clock
const timers = [];
export const wait = s => new Promise(r => timers.push({ at: T.sim + s, r }));
export function runTimers() { for (let i = timers.length - 1; i >= 0; i--) if (T.sim >= timers[i].at) { const t = timers.splice(i, 1)[0]; t.r(); } }

// ------------------------------------------------------------------ routes
const ADJ = {};
for (const [a, b] of EDGES) { (ADJ[a] ||= []).push(b); (ADJ[b] ||= []).push(a); }
export function route(from, to) {
  const prev = { [from]: null }, q = [from];
  while (q.length) { const n = q.shift(); if (n === to) break; for (const m of ADJ[n]) if (!(m in prev)) { prev[m] = n; q.push(m); } }
  const out = []; for (let n = to; n; n = prev[n]) out.unshift(n);
  return out;
}
export function nearestNode(x, z) {
  let best = 'plaza', bd = 1e9;
  for (const [k, [nx, nz]] of Object.entries(NODES)) { const d = (nx - x) ** 2 + (nz - z) ** 2; if (d < bd) { bd = d; best = k; } }
  return best;
}
export const SPOTS = {};
export function spot(name, x, z, look, node, label) { SPOTS[name] = { x, z, look, node: node || nearestNode(x, z), label: label || name }; return SPOTS[name]; }
spot('well', 2.2, 1.8, [0, 0], 'plaza', 'the well');
for (let i = 0; i < 4; i++) { const a = Math.PI * (0.78 + i * 0.16);
  spot('stall' + i, Math.cos(a) * 13.4, Math.sin(a) * 13.4, [0, 0], 'plaza', 'the market');
  spot('buy' + i, Math.cos(a) * 9.4, Math.sin(a) * 9.4, [Math.cos(a) * 11.5, Math.sin(a) * 11.5], 'plaza', 'the market'); }
spot('drink', 14.5, -7.5, [15, -7], 'plaza', 'the tavern');
spot('party', 9, 8, [9, 8], 'plaza', 'the bonfire');
spot('watch', 0, 36, [0, 130], 'harbor', 'the harbour');
spot('oven', -34.6, -4.6, [-36, -6], 'w1', 'the bread oven');
spot('chop', -66, 15.4, [-66, 17], 'forest', 'the chopping block');
spot('chop2', -98, 0.4, [-98, 2], 'deep', 'the chopping block');
spot('woodshed', -74, 24, [-77, 27], 'forest', 'the woodshed');
spot('pierEnd', 1.4, 89, [1.4, 120], 'pier', 'the end of the pier');
spot('gangplank', 2.4, 74, [10, 74], 'pier', 'the pier');
spot('moor0', 36.4, 64, [40, 64], 'pier2', 'the fishing pier');
spot('moor1', 36.4, 76, [40, 76], 'pier2', 'the fishing pier');
spot('crates', 14, 41, [12, 43], 'harbor', 'the warehouse');
spot('pier2End', 34, 80, [34, 90], 'pier2', 'the fishing pier');
spot('chapelYard', 4, -46, [0, -58], 'chapel', 'the chapel');
spot('millYard', 28, -50, [33, -60], 'mill', 'the windmill');
spot('towerYard', -34, -42, [-38, -50], 'tower', 'the watchtower');
spot('harborFront', 6, 40, [6, 70], 'harbor', 'the harbour');
spot('beach', -34, 41, [-34, 80], 'sw', 'the beach');
spot('treasure', -44, 40.5, [-44, 60], 'beachW', 'the beach');
spot('coopYard', 48, 13, [46, 18], 'farm', 'the chicken coop');
spot('hives', 41.5, 27.5, [41.5, 30.5], 'farm', 'the beehives');
spot('pasture', 52, -20, [58, -26], 'pasture', 'the pasture');
spot('pastureN', 64, -29, [58, -24], 'pasture', 'the pasture');
spot('paddock', 92, -10, [96, -14], 'paddock', 'the horse paddock');
spot('lakeShore', 93, -63, [LAKE.x, LAKE.z], 'lake', 'the lake');
spot('camp', -121, 27.5, [-120, 30], 'camp', 'camp');
spot('fortGate', 2, -134, [0, -100], 'fortGate', 'the fort gate');
spot('fortYard', 6, -168, [0, -168], 'fortIn', 'the fort');
spot('fortE', 17, -178, [26, -180], 'fortIn', 'the fort wall');
spot('fortW', -17, -178, [-26, -180], 'fortIn', 'the fort wall');
spot('fortFire', 2, -166, [0, -168], 'fortIn', 'the fort');
spot('caravan', 25, 3.5, [20, 0], 'e1', 'the caravan');
spot('bearSpot', -6, 4, [-10, 6], 'plaza', 'the market');
export function homeSpot(home) {
  const key = 'home:' + home;
  if (!SPOTS[key]) {
    if (home === 'camp') return 'camp';
    const h = HOMES[home], o = placed[home];
    if (!h) return 'well';
    let x = h.x, z = h.z + 4;
    if (o) { const box = new THREE.Box3().setFromObject(o), r = Math.min(box.max.x - box.min.x, box.max.z - box.min.z) / 2 + 0.8;
      x = h.x + Math.sin(o.rotation.y) * r; z = h.z + Math.cos(o.rotation.y) * r; }
    spot(key, x, z, [h.x, h.z], undefined, 'home');
  }
  return key;
}

// ------------------------------------------------------------------ speech bubbles
const bubbleLayer = document.getElementById('bubbles');
const _v = new THREE.Vector3();
function placeBubble(el, pos, lift) {
  _v.copy(pos); _v.y += lift; const d = camera.position.distanceTo(_v);
  _v.project(camera);
  const vis = _v.z < 1 && d < 70 && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1;
  el.style.display = vis ? 'block' : 'none';
  if (vis) { el.style.left = ((_v.x + 1) / 2 * innerWidth) + 'px'; el.style.top = ((1 - _v.y) / 2 * innerHeight) + 'px'; el.style.fontSize = Math.max(11, 18 - d / 6) + 'px'; }
}

// ------------------------------------------------------------------ people
const animMod = import(CDN + 'clips.mjs');
export const people = [];
export const ACT_TEXT = { Watering: 'watering the crops', Harvesting: 'bringing in the harvest', Planting: 'planting seeds', 'Chopping wood': 'chopping wood',
  Drinking: 'having a drink', Laughing: 'laughing at a terrible joke', Dance: 'dancing', 'Hip hop': 'showing off some moves', Twist: 'doing the twist',
  Thriller: 'doing a very spooky dance', Talking: 'chatting', 'Arms folded': 'keeping watch', 'Leaning on rail': 'watching the sea',
  'Calling from rail': 'shouting at the gulls', 'Holding torch': 'on night watch', Eating: 'having a snack', Interact: 'stacking things',
  'Drunk idle': 'swaying a bit too much', 'Pick up': 'picking something up', Crouch: 'poking at a beetle', Agree: 'nodding along',
  'Head shake': 'shaking their head', Punch: 'throwing punches!', Kick: 'kicking!', Idle: 'taking a breather', Fixing: 'mending things',
  'Holding lantern': 'holding up a lantern', Sitting: 'sitting', 'Phone call': 'talking to themself', Fishing: 'fishing', Driving: 'driving the wagon' };
const BASE_CLIPS = ['Idle', 'Walk', 'Run', 'Talking', 'Laughing', 'Agree', 'Head shake', 'Drinking', 'Dance', 'Hip hop', 'Twist', 'Eating', 'Pick up', 'Punch', 'Kick', 'Crouch', 'Arms folded', 'Walk carrying'];
export class Person {
  constructor(name, role, id, home, clips = [], opts = {}) {
    Object.assign(this, { name, role, id, home, opts, path: [], until: 0, plan: null, spotKey: null, hidden: !!opts.startHidden, speed: 1.4, doing: '' });
    this.clips = [...new Set([...BASE_CLIPS, ...clips])];
    this.idx = people.length; people.push(this);
    job(() => this.load());
  }
  async load() {
    this.obj = await make(this.id, true);
    const { animate } = await animMod;
    this.anim = await animate(this.obj, { clips: this.clips });
    this.obj.visible = !this.hidden;
    scene.add(this.obj);
    this.obj.traverse(b => { if (!this.hand && b.isBone && /righthand$/i.test(b.name)) this.hand = b; });
    if (this.opts.torch || this.opts.lantern) {
      this.flame = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.32, 6), new THREE.MeshBasicMaterial({ color: 0xffa040 }));
      this.handLight = new THREE.PointLight(0xff9a40, 0, 16, 1.5);
      this.handGlow = glow(2.4);
      scene.add(this.flame, this.handLight, this.handGlow);
    }
    this.ready = true;
  }
  get pos() { return this.obj.position; }
  say(text, secs = 3) {
    if (!this.bubble) { this.bubble = document.createElement('div'); this.bubble.className = 'bubble'; bubbleLayer.appendChild(this.bubble); }
    this.bubble.textContent = text; this.bubbleUntil = T.real + secs; this.bubble.classList.add('on');
  }
  // plan: { spot, act, dur, run, hide, carry, text, moveText, onArrive, logText, ring, exact, direct, look }
  go(plan) { return new Promise(res => { this.start({ ...plan, onArrive: p => { plan.onArrive?.(p); res(p); } }); }); }
  start(plan) {
    if (!this.ready) return;
    this.ride = null;
    this.plan = plan;
    const key = plan.spot === 'home' ? homeSpot(this.home) : plan.spot;
    const s = typeof key === 'string' ? SPOTS[key] : key;
    if (!s) { console.warn('no spot', key); return; }
    let tx = s.x, tz = s.z;
    if (!plan.exact) { const a = this.idx * 2.399 + (plan.ring ? T.sim * 0 : 0); const r = plan.ring ?? 0.9; tx += Math.cos(a) * r; tz += Math.sin(a) * r; }
    if (plan.direct) this.path = [V(tx, tz)];
    else {
      const nodes = route(nearestNode(this.pos.x, this.pos.z), s.node || nearestNode(s.x, s.z));
      this.path = nodes.map(n => V(...NODES[n])).concat([V(tx, tz)]);
      if (this.path.length > 1 && this.path[0].distanceTo(this.path[1]) > this.pos.distanceTo(this.path[1])) this.path.shift();
    }
    this.target = s; this.spotKey = typeof key === 'string' ? key : null;
    this.speed = plan.run ? 3.9 : plan.speed || (plan.carry ? 1.1 : 1.4);
    if (this.hidden) { this.hidden = false; this.obj.visible = true; }
    if (plan.carry) this.anim.play('Walk carrying'); else this.anim.locomotion(this.speed);
    this.doing = plan.moveText || `${plan.run ? 'running' : 'walking'} to ${plan.spot === 'home' ? 'home' : s.label || 'somewhere'}`;
    this.moving = true; this.until = Infinity;
    if (plan.logText) log(plan.logText);
    if (plan.say) this.say(plan.say);
  }
  arrive() {
    this.moving = false;
    const p = this.plan;
    if (p.hide) { this.hidden = true; this.obj.visible = false; this.doing = 'indoors'; }
    else { this.anim.play(p.act || 'Idle');
      this.doing = p.text || (ACT_TEXT[p.act] || 'taking a breather') + (p.spot === 'party' ? ' by the bonfire' : p.spot === 'drink' ? ' outside the tavern' : ''); }
    const look = p.look || this.target.look;
    this.lookYaw = look ? faceYaw(this.pos.x, this.pos.z, look[0], look[1]) : null;
    this.until = T.sim + (p.dur ?? 20);
    if (p.onArrive) p.onArrive(this);
  }
  act(clip, secs, text) { this.anim.play(clip); this.doing = text || ACT_TEXT[clip] || clip; this.until = T.sim + secs; this.moving = false; this.path = []; }
  board(obj, off, clip, yaw = 0) { this.path = []; this.moving = false; this.ride = { obj, off, yaw }; this.anim.play(clip); this.hidden = false; this.obj.visible = true; this.until = Infinity; }
  update(dt, near) {
    if (!this.ready) return;
    if (this.ride) {
      const r = this.ride; r.obj.updateMatrixWorld(true);
      this.pos.copy(r.off).applyMatrix4(r.obj.matrixWorld);
      this.obj.rotation.y = r.obj.rotation.y + r.yaw;
    } else if (this.path.length) {
      const t = this.path[0], dx = t.x - this.pos.x, dz = t.z - this.pos.z, d = Math.hypot(dx, dz), step = this.speed * dt;
      if (d <= step) { this.pos.x = t.x; this.pos.z = t.z; this.path.shift(); if (!this.path.length) this.arrive(); }
      else { this.pos.x += dx / d * step; this.pos.z += dz / d * step;
        this.obj.rotation.y = lerpAngle(this.obj.rotation.y, Math.atan2(dx, dz), 1 - Math.exp(-8 * dt)); }
      this.pos.y = groundY(this.pos.x, this.pos.z);
    } else {
      if (this.lookYaw != null) this.obj.rotation.y = lerpAngle(this.obj.rotation.y, this.lookYaw, 1 - Math.exp(-4 * dt));
      if (T.sim >= this.until && !this.busy) this.think();
      this.pos.y = groundY(this.pos.x, this.pos.z);
    }
    if (!this.hidden && near) this.anim.update(dt);
    if (this.flame) {
      const on = !this.hidden && (this.lightOn ?? (this.opts.torch && light.lampsOn > 0.4));
      this.flame.visible = on; this.handGlow.material.opacity = on ? 0.9 : 0;
      this.handLight.intensity = on ? 9 + Math.sin(T.sim * 23 + this.idx) * 1.5 : 0;
      if (on) { const p = new THREE.Vector3(); if (this.hand) this.hand.getWorldPosition(p); else p.copy(this.pos).add(V(0.3, 0, 1.4)); p.y += 0.3;
        this.flame.position.copy(p); this.handLight.position.copy(p); this.handGlow.position.copy(p); }
    }
    if (this.bubble) { if (T.real > this.bubbleUntil || this.hidden) this.bubble.style.display = 'none'; else placeBubble(this.bubble, this.pos, 2.4); }
  }
  think() {
    const plan = ROLES[this.role]?.(this, hourNow());
    if (!plan) { this.until = T.sim + 2; return; }
    const key = plan.spot === 'home' ? homeSpot(this.home) : plan.spot;
    if (key === this.spotKey && !!plan.hide === this.hidden && (plan.hide || plan.act === this.plan?.act)) { this.until = T.sim + (plan.dur ?? 20); return; }
    this.start(plan);
  }
}

// ------------------------------------------------------------------ what each kind of person does with their day
export const shared = { fireworks: [21.9, 22.75], caravanHere: false, sloop: null, boats: [], canoe: null, rainRun: false };
export const party = h => inH(h, 20.25, 23.4) && !inH(h, ...shared.fireworks);
const watching = h => inH(h, ...shared.fireworks);
const moves = ['Dance', 'Hip hop', 'Twist', 'Dance', 'Laughing'];
const evening = (p, h, from = 18) => {
  if (watching(h)) return { spot: 'watch', act: pick(['Idle', 'Agree', 'Laughing']), dur: 8, ring: 3 + (p.idx % 5) * 1.3, text: 'watching the fireworks' };
  if (party(h)) return { spot: 'party', act: pick(moves), dur: 22, ring: 3.4 + (p.idx % 3) * 0.9 };
  if (inH(h, from, 20.25)) return { spot: 'drink', act: pick(['Drinking', 'Laughing', 'Talking', 'Drinking']), dur: 26, ring: 2.2 };
  return null;
};
const sleep = () => ({ spot: 'home', hide: true, dur: 40 });
const rainy = (p) => shared.rainRun && !p.opts.braveRain ? { spot: 'home', hide: true, dur: 30, run: true, moveText: 'running out of the rain' } : null;
export const ROLES = {
  farmer(p, h) {
    if (inH(h, 6, 18)) { if (rainy(p)) return rainy(p);
      if (inH(h, 12, 13)) return { spot: 'drink', act: pick(['Drinking', 'Eating']), dur: 30, ring: 2 };
      const f = pick(FIELD); return { spot: spot('field' + p.idx, f[0], f[1], [f[0], f[1] + 1.4], 'farm', 'the fields'), act: pick(['Watering', 'Harvesting', 'Planting']), dur: rr(20, 34), exact: true }; }
    return evening(p, h) || sleep();
  },
  woodcutter(p, h) {
    if (inH(h, 6.5, 17)) {
      if (p.plan?.act === 'Chopping wood') return { spot: 'woodshed', carry: true, act: 'Interact', dur: 6, moveText: 'hauling logs to the woodshed', text: 'stacking firewood', exact: true };
      return { spot: p.opts.chop || 'chop', act: 'Chopping wood', dur: rr(26, 40), exact: true };
    }
    return evening(p, h, 17) || sleep();
  },
  vendor(p, h) {
    if (inH(h, 7.5, 18)) return rainy(p) || { spot: 'stall' + p.opts.stall, act: pick(['Talking', 'Arms folded', 'Talking', 'Agree']), dur: 18, exact: true,
      text: p.opts.sells, onArrive: q => { if (rnd() < 0.3) q.say(pick(p.opts.calls), 3); } };
    return evening(p, h) || sleep();
  },
  baker(p, h) {
    if (inH(h, 5, 9.5)) return { spot: 'oven', act: pick(['Fixing', 'Interact']), dur: 25, exact: true, text: 'baking bread', onArrive: q => rnd() < 0.3 && q.say('Mmm, fresh loaves!') };
    if (inH(h, 9.5, 16)) return rainy(p) || { spot: 'stall1', act: pick(['Talking', 'Agree', 'Arms folded']), dur: 18, exact: true, text: 'selling bread',
      onArrive: q => { if (rnd() < 0.35) q.say(pick(['Fresh bread!', 'Two loaves a penny!', 'Still warm!']), 3); } };
    return evening(p, h, 16) || sleep();
  },
  guard(p, h) {
    if (inH(h, 6.5, 19.5)) return { spot: pick(['towerYard', 'chapelYard', 'millYard', 'harborFront', 'well', 'coopYard', 'buy2']), act: pick(['Arms folded', 'Idle', 'Agree']), dur: rr(14, 26) };
    return { spot: pick(['well', 'chapelYard', 'harborFront', 'towerYard', 'millYard', 'drink', 'beach']), act: 'Holding torch', dur: rr(10, 18), text: 'on night watch with a torch' };
  },
  knight(p, h) {
    if (inH(h, 11.5, 13) && p.opts.patrols) return { spot: pick(['well', 'drink', 'buy0']), act: pick(['Arms folded', 'Talking', 'Agree']), dur: 22, text: 'down from the fort, keeping order' };
    if (party(h) && p.opts.patrols) return { spot: 'party', act: pick(['Dance', 'Agree']), dur: 22, ring: 4 };
    if (inH(h, 22.5, 6)) return { spot: pick(['fortGate', 'fortE', 'fortW', 'fortFire']), act: 'Holding torch', dur: rr(12, 22), text: 'guarding the fort by torchlight' };
    return { spot: pick(['fortGate', 'fortE', 'fortW', 'fortYard', 'fortGate']), act: pick(['Arms folded', 'Idle', 'Agree']), dur: rr(14, 26), text: 'standing guard at the fort' };
  },
  priest(p, h) {
    if (inH(h, 7, 17)) return rainy(p) || { spot: pick(['chapelYard', 'chapelYard', 'well', 'buy3']), act: pick(['Talking', 'Agree', 'Idle']), dur: rr(18, 30),
      onArrive: q => rnd() < 0.25 && q.say(pick(['Blessings, friend.', 'Lovely day for it.', 'Mind the pirates.'])) };
    return evening(p, h, 17) || sleep();
  },
  railFisher(p, h) {
    if (inH(h, 5.5, 17)) return rainy(p) || { spot: 'pierEnd', act: rnd() < 0.75 ? 'Leaning on rail' : 'Calling from rail', dur: 35, exact: true,
      onArrive: q => q.plan.act === 'Calling from rail' && q.say(pick(['Oi! Gulls!', 'Anything biting?', 'Ahoy there!'])) };
    return evening(p, h, 17) || sleep();
  },
  boatFisher(p, h) {
    const b = shared.boats[p.opts.boat];
    if (b && inH(h, 5.2, 15.2) && b.state === 'moored' && !b.crew) return { spot: 'moor' + p.opts.boat, act: 'Idle', dur: 1, exact: true, text: 'climbing aboard', onArrive: q => b.board(q) };
    if (inH(h, 15.2, 17.5)) return { spot: 'crates', act: pick(['Talking', 'Pick up']), dur: 20, text: 'selling the catch', onArrive: q => rnd() < 0.4 && q.say('Fresh fish!') };
    return evening(p, h, 17.5) || sleep();
  },
  docker(p, h) {
    if (inH(h, 7, 17)) return rainy(p) || (p.plan?.carry
      ? { spot: 'crates', act: 'Pick up', dur: 4, exact: true, text: 'loading crates' }
      : { spot: 'pier2End', carry: true, act: 'Interact', dur: 4, exact: true, moveText: 'carrying a crate down the pier', text: 'stacking crates' });
    return evening(p, h, 17) || sleep();
  },
  kid(p, h) {
    if (inH(h, 19.5, 21.9)) return { spot: 'party', act: pick(['Dance', 'Hip hop', 'Twist']), dur: 20, ring: 3.6 };
    if (watching(h)) return { spot: 'watch', act: pick(['Laughing', 'Dance']), dur: 8, ring: 2 + p.idx % 4, text: 'watching the fireworks' };
    if (inH(h, 7.5, 19.5)) return { spot: pick(['well', 'beach', 'coopYard', 'buy0', 'harborFront', 'pasture', 'chapelYard', 'party']), run: true,
      act: pick(['Laughing', 'Crouch', 'Pick up', 'Dance', 'Idle']), dur: rr(10, 20), ring: 2 };
    return sleep();
  },
  shopper(p, h) {
    if (inH(h, 8, 17)) return rainy(p) || { spot: shared.caravanHere && rnd() < 0.35 ? 'caravan' : pick(['buy0', 'buy1', 'buy2', 'buy3', 'well', 'drink', 'harborFront', 'crates']),
      act: pick(['Talking', 'Agree', 'Pick up', 'Eating', 'Head shake']), dur: rr(14, 26), ring: 1.4,
      onArrive: q => rnd() < 0.2 && q.say(pick(['How much?!', 'Lovely!', 'I\'ll take two.', 'Did you hear about the pirates?', 'Is that a bear?'])) };
    return evening(p, h) || sleep();
  },
  shepherd(p, h) {
    if (inH(h, 6, 18.5)) return { spot: pick(['pasture', 'pastureN', 'pasture']), act: pick(['Arms folded', 'Idle', 'Agree']), dur: rr(18, 30), ring: 3, text: 'minding the sheep' };
    return evening(p, h, 18.5) || sleep();
  },
  hiker(p, h) {
    const c = shared.canoe;
    if (c && inH(h, 8.5, 16) && c.state === 'moored' && !c.crew) return { spot: 'lakeShore', act: 'Idle', dur: 1, exact: true, text: 'getting into the canoe', onArrive: q => c.board(q) };
    if (inH(h, 18.5, 23.5)) return { spot: 'camp', act: pick(['Arms folded', 'Idle', 'Eating']), dur: 25, ring: 1.8, text: 'sitting by the campfire' };
    if (inH(h, 23.5, 6.5)) return { spot: 'camp', hide: true, dur: 40 };
    return { spot: pick(['lakeShore', 'millYard', 'camp', 'chop2']), act: pick(['Idle', 'Crouch', 'Pick up']), dur: 20, text: 'exploring' };
  },
  trader(p, h) {
    if (shared.caravanHere) return { spot: 'caravan', act: pick(['Talking', 'Agree', 'Laughing']), dur: 18, exact: true, text: 'selling exotic goods',
      onArrive: q => rnd() < 0.4 && q.say(pick(['Silks from the east!', 'Spices! Rare spices!', 'Best prices on the coast!'])) };
    return null;
  },
  pirate(p, h) {
    const s = shared.sloop;
    if (!s || (!s.docked && p.hidden) || p.aboard) return null;
    if (inH(h, 1.5, 6) || s.leaving) return { spot: 'gangplank', act: 'Idle', hide: true, dur: 999, exact: true, moveText: 'staggering back to the ship', onArrive: () => { p.aboard = true; } };
    if (watching(h)) return { spot: 'watch', act: pick(['Laughing', 'Drunk idle']), dur: 8, ring: 5, text: 'watching the fireworks' };
    if (inH(h, 20.25, 1.5)) return { spot: 'party', act: p.opts.captain ? pick(['Thriller', 'Hip hop', 'Drunk idle']) : pick(['Hip hop', 'Twist', 'Drunk idle', 'Laughing']), dur: 22, ring: 3.6 };
    return { spot: 'drink', act: pick(['Drinking', 'Laughing', 'Drinking', 'Talking']), dur: 26, ring: 2.4, onArrive: q => rnd() < 0.3 && q.say(pick(['Arr!', 'More rum!', 'Yo ho ho!', 'Who stole me hat?'])) };
  },
};

export const mara = new Person('Mara', 'farmer', 'farmer-304a43', 'farmhouse', ['Watering', 'Harvesting', 'Planting', 'Holding lantern'], { lantern: true });
new Person('Jory', 'farmer', 'villager-40255c', 'farmhouse', ['Watering', 'Harvesting', 'Planting']);
export const bram = new Person('Bram', 'woodcutter', 'forest-ranger-6906b0', 'cabin', ['Chopping wood', 'Walk carrying', 'Interact', 'Punch', 'Kick']);
new Person('Edda', 'woodcutter', 'tradesman-1707b9', 'houseW', ['Chopping wood', 'Walk carrying', 'Interact'], { chop: 'chop2' });
export const odo = new Person('Odo', 'vendor', 'merchant-6f606b', 'merchantHouse', ['Arms folded'], { stall: 0, sells: 'selling fish', calls: ['Fresh fish!', 'Herring! Cod!', 'Caught this morning!'] });
new Person('Ilse', 'baker', 'townswoman-5aa87f', 'bakery', ['Fixing', 'Interact', 'Arms folded']);
new Person('Rook', 'vendor', 'tradesman-1707b9', 'houseE', ['Arms folded'], { stall: 2, sells: 'selling pots and pans', calls: ['Pots! Pans!', 'Good iron, cheap!', 'Mind the merchandise!'] });
new Person('Mag', 'vendor', 'townswoman-5aa87f', 'houseNW', ['Arms folded'], { stall: 3, sells: 'selling apples', calls: ['Apples! Sweet apples!', 'Straight off the tree!'] });
export const hollis = new Person('Hollis', 'guard', 'village-guard-5f0f6f', 'guardTower', ['Arms folded', 'Holding torch', 'Punch', 'Kick'], { torch: true, braveRain: true });
new Person('Sef', 'railFisher', 'hanga-roa-fisherman-e56812', 'shack', ['Leaning on rail', 'Calling from rail']);
new Person('Nell', 'boatFisher', 'hanga-roa-fisherman-e56812', 'shack2', ['Fixing'], { boat: 0 });
new Person('Corin', 'boatFisher', 'cove-trader-0f94a6', 'shack2', ['Fixing'], { boat: 1 });
new Person('Dax', 'docker', 'tradesman-1707b9', 'houseS2', ['Walk carrying', 'Interact']);
new Person('Lune', 'docker', 'villager-40255c', 'houseS1', ['Walk carrying', 'Interact']);
export const pip = new Person('Pip', 'kid', 'village-child-bef09e', 'cottageA', ['Crouch'], { braveRain: true });
new Person('Tam', 'kid', 'kite-kid-0a7d70', 'cottageB', ['Crouch'], { braveRain: true });
new Person('Bee', 'kid', 'waving-child-dfada0', 'houseS1', ['Crouch'], { braveRain: true });
new Person('Wren', 'shopper', 'townswoman-5aa87f', 'cottageA');
new Person('Tobin', 'shopper', 'tradesman-1707b9', 'cottageB');
new Person('Greta', 'shopper', 'townswoman-5aa87f', 'houseNW');
new Person('Ser Gareth', 'knight', 'armoured-knight-hero-07121f', 'fortHall', ['Arms folded', 'Holding torch', 'Punch'], { torch: true, patrols: true, braveRain: true });
new Person('Ser Alys', 'knight', 'armoured-knight-hero-07121f', 'fortHall', ['Arms folded', 'Holding torch'], { torch: true, braveRain: true });
new Person('Ana', 'shepherd', 'villager-40255c', 'houseE', ['Arms folded']);
new Person('Lo', 'hiker', 'hiker-3d1a41', 'camp', ['Sitting', 'Crouch', 'Arms folded'], { braveRain: true });
new Person('Father Aldo', 'priest', 'preacher-a49199', 'houseN', []);
export const trader = new Person('Vesk', 'trader', 'cove-trader-0f94a6', 'shack', ['Driving'], { startHidden: true });
export const pirates = [
  new Person('Captain Redd', 'pirate', 'pirate-captain-91f545', 'shack', ['Thriller', 'Drunk idle', 'Crouch', 'Punch'], { startHidden: true, captain: true, braveRain: true }),
  new Person('Gully', 'pirate', 'pirate-deckhand-98a6e7', 'shack', ['Drunk idle', 'Punch', 'Kick', 'Crouch'], { startHidden: true, braveRain: true }),
  new Person('Fenn', 'pirate', 'pirate-deckhand-98a6e7', 'shack', ['Drunk idle', 'Crouch', 'Punch'], { startHidden: true, braveRain: true }),
];
for (const p of pirates) p.aboard = true;
export const ROLE_NAME = { farmer: 'farmer', woodcutter: 'woodcutter', vendor: 'market trader', baker: 'the baker', guard: 'the town guard', knight: 'knight of the hill fort',
  priest: 'the priest', railFisher: 'old fisherman', boatFisher: 'fisher', docker: 'dock worker', kid: 'local troublemaker', shopper: 'villager', shepherd: 'shepherd',
  hiker: 'travelling hiker', trader: 'travelling merchant', pirate: 'pirate' };

// ------------------------------------------------------------------ animals
export const animals = [];
let walkMod;
export class Beast {
  constructor(name, id, region, opts = {}) {
    Object.assign(this, { name, id, region, opts, dist: 0, goal: null, wait: rr(0, 6), mul: 1 }); animals.push(this);
    job(() => this.load());
  }
  async load() {
    walkMod ||= import(CDN + 'walk.mjs');
    const { walker, naturalSpeed } = await walkMod;
    this.obj = await make(this.id, true);
    const [x0, x1, z0, z1] = this.region;
    const x = rr(x0, x1), z = rr(z0, z1);
    this.obj.position.set(x, this.opts.y ?? groundY(x, z), z);
    this.obj.rotation.y = rr(0, 6.28);
    if (this.opts.s) this.obj.scale.setScalar(this.opts.s);
    scene.add(this.obj);
    this.obj.updateMatrixWorld(true);
    const ground = this.opts.y != null ? (() => { const y = this.opts.y, n = new THREE.Vector3(0, 1, 0); return () => ({ y, normal: n }); })() : groundAt;
    try { this.gait = walker(this.obj, { ground }); this.base = Math.min(this.opts.speed || 9, naturalSpeed(this.gait) || 1); }
    catch { this.gait = null; this.base = this.opts.speed || 1; }
    this.ready = true;
  }
  get pos() { return this.obj.position; }
  go(points, mul = 1) { return new Promise(res => { this.route = points.map(p => V(p[0], p[1])); this.mul = mul; this.goal = this.route.shift(); this.onArrive = res; }); }
  say(text, secs = 2.5) {
    if (!this.bubble) { this.bubble = document.createElement('div'); this.bubble.className = 'bubble'; bubbleLayer.appendChild(this.bubble); }
    this.bubble.textContent = text; this.bubbleUntil = T.real + secs;
  }
  update(dt, near) {
    if (!this.ready) return;
    if (this.follow) this.follow(this);
    if (this.fly) {
      const f = this.fly; f.t = Math.min(1, f.t + dt / f.dur);
      this.pos.lerpVectors(f.a, f.b, f.t); this.pos.y = THREE.MathUtils.lerp(f.a.y, f.b.y, f.t) + Math.sin(f.t * Math.PI) * f.h;
      this.obj.rotation.y = Math.atan2(f.b.x - f.a.x, f.b.z - f.a.z);
      if (f.t >= 1) { this.fly = null; this.wait = rr(1, 4); }
    } else if (!this.goal) {
      this.wait -= dt;
      if (this.wait <= 0 && !this.held) { const [x0, x1, z0, z1] = this.region; this.go([[rr(x0, x1), rr(z0, z1)]], 1); }
    } else {
      const dx = this.goal.x - this.pos.x, dz = this.goal.z - this.pos.z, d = Math.hypot(dx, dz), step = this.base * this.mul * dt;
      if (d < Math.max(step, 0.3)) {
        if (this.route.length) this.goal = this.route.shift();
        else { this.goal = null; this.wait = rr(...(this.opts.idle || [3, 10])); const cb = this.onArrive; this.onArrive = null; cb && cb(this); }
      } else {
        this.pos.x += dx / d * step; this.pos.z += dz / d * step; this.dist += step;
        this.obj.rotation.y = lerpAngle(this.obj.rotation.y, Math.atan2(dx, dz), 1 - Math.exp(-3 * dt));
        if (!this.gait) this.pos.y = (this.opts.y ?? groundY(this.pos.x, this.pos.z)) + Math.abs(Math.sin(this.dist * 3)) * 0.08;
      }
    }
    if (this.gait && near && !this.fly) { this.obj.updateMatrixWorld(true); this.gait.poseAt(this.dist); }
    if (this.bubble) { if (T.real > this.bubbleUntil) this.bubble.style.display = 'none'; else placeBubble(this.bubble, this.pos, 1.6); }
  }
  // birds: hop up and flutter somewhere else in their patch
  flee(from, h = 3) {
    if (this.fly) return;
    const [x0, x1, z0, z1] = this.region, a = this.pos.clone();
    let bx = rr(x0, x1), bz = rr(z0, z1);
    if (from) { const dx = a.x - from.x, dz = a.z - from.z, d = Math.hypot(dx, dz) || 1; bx = a.x + dx / d * rr(6, 12); bz = a.z + dz / d * rr(6, 12); }
    this.goal = null; this.fly = { a, b: V(bx, bz, groundY(bx, bz)), t: 0, dur: rr(1.2, 2), h };
  }
}
for (let i = 0; i < 8; i++) new Beast('a hen', 'chicken-e70282', [40, 54, 10, 24], { idle: [1, 5] });
for (let i = 0; i < 8; i++) new Beast('a sheep', 'sheep-7b0187', [45, 73, -31, -17], { idle: [5, 14] });
for (let i = 0; i < 3; i++) new Beast('a cow', 'cow-c61a66', [45, 73, -31, -17], { idle: [8, 18] });
for (let i = 0; i < 2; i++) new Beast('a goat', 'goat-1dedee', [45, 73, -31, -17], { idle: [3, 9] });
for (const id of ['horse-base', 'draft-horse-519160', 'saddled-horse-da86d3']) new Beast('a horse', id, [85, 103, -21, -7], { idle: [5, 14] });
for (let i = 0; i < 6; i++) new Beast('a duck', 'duck-357dc6', [LAKE.x - 18, LAKE.x + 18, LAKE.z - 18, LAKE.z + 18], { idle: [2, 8], y: -0.5 });
for (let i = 0; i < 8; i++) new Beast('a rabbit', 'forest-rabbit-ea2da0', [-150, -50, -70, 40], { idle: [2, 7] });
for (let i = 0; i < 5; i++) new Beast('a deer', 'forest-deer-fe648d', [-160, -122, -90, -52], { idle: [4, 12], speed: 1.2 });
export const pigeons = [...Array(10)].map(() => new Beast('a pigeon', 'pigeon-base', [-9, 9, -9, 9], { idle: [1, 5] }));
export const chickens = animals.filter(a => a.name === 'a hen');
export const fox = new Beast('the fox', 'red-fox-5c3bc0', [-130, -60, -40, 30], { idle: [3, 9] });
export const bear = new Beast('the bear', 'black-bear-adbdc7', [-190, -150, -50, -12], { idle: [6, 14] });
export const dog = new Beast('Rufus the dog', 'farm-dog-723730', [54, 68, 8, 16], { idle: [2, 6] });
export const caravanHorse = new Beast('the caravan horse', 'saddled-horse-da86d3', [330, 332, 8, 12], { idle: [999, 999] });
caravanHorse.held = true;
dog.follow = d => {
  if (d.held || !mara.ready || mara.hidden || !inH(hourNow(), 6, 18)) return;
  const far = d.pos.distanceTo(mara.pos);
  if (far > 6 && (!d.goal || d.goal.distanceTo(mara.pos) > 4)) d.go([[mara.pos.x + 1.5, mara.pos.z + 1.5]], far > 14 ? 2.6 : 1.2);
};

// pigeons scatter from anyone who walks through them; hens from the fox
export function disturbBirds() {
  for (const b of pigeons) {
    if (!b.ready || b.fly) continue;
    for (const p of people) if (p.ready && !p.hidden && p.moving && p.pos.distanceToSquared(b.pos) < 5) { b.flee(p.pos, 3.5); break; }
    if (bear.ready && bear.pos.distanceToSquared(b.pos) < 60) b.flee(bear.pos, 5);
  }
}

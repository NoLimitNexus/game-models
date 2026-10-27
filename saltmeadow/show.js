// Everything on the water and in the sky: ships, boats, the sea battle, the balloon, dolphins, gulls and fireworks.
import * as THREE from 'three';
import { scene, T, hourNow, inH, rr, rnd, pick, V, make, job, glow, puff, log, shout, WATER_Y, LAKE, groundY, puffTex } from './core.js';
import { waveAt } from './world.js';
import { shared } from './life.js';

// ------------------------------------------------------------------ sparks: one additive particle system per size
class Sparks {
  constructor(n, size) {
    this.n = n; this.next = 0;
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3); this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n); this.max = new Float32Array(n); this.drag = new Float32Array(n); this.grav = new Float32Array(n); this.base = new Float32Array(n * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ size, map: puffTex, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    this.points.frustumCulled = false; scene.add(this.points);
    for (let i = 0; i < n; i++) this.pos[i * 3 + 1] = -999;
  }
  emit(x, y, z, vx, vy, vz, color, life, drag = 0.4, grav = 6) {
    const i = this.next = (this.next + 1) % this.n, c = new THREE.Color(color);
    this.pos.set([x, y, z], i * 3); this.vel.set([vx, vy, vz], i * 3); this.base.set([c.r, c.g, c.b], i * 3);
    this.life[i] = this.max[i] = life; this.drag[i] = drag; this.grav[i] = grav;
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.pos[i * 3 + 1] = -999; this.col.set([0, 0, 0], i * 3); continue; }
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= k; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.grav[i] * dt; this.vel[i * 3 + 2] *= k;
      for (let j = 0; j < 3; j++) this.pos[i * 3 + j] += this.vel[i * 3 + j] * dt;
      const t = this.life[i] / this.max[i], f = t > 0.25 ? 1 : t * 4, tw = 0.75 + 0.25 * Math.sin(i * 7.1 + T.real * 30);
      for (let j = 0; j < 3; j++) this.col[i * 3 + j] = this.base[i * 3 + j] * f * tw;
    }
    this.points.geometry.attributes.position.needsUpdate = true; this.points.geometry.attributes.color.needsUpdate = true;
  }
}
export const fwSparks = new Sparks(5000, 2.2);
export const waterSparks = new Sparks(1500, 0.7);
function splash(x, z, big = 1) {
  for (let i = 0; i < 40 * big; i++) waterSparks.emit(x + rr(-0.6, 0.6) * big, WATER_Y + 0.2, z + rr(-0.6, 0.6) * big, rr(-1.5, 1.5) * big, rr(4, 9) * big, rr(-1.5, 1.5) * big, 0xbfe6ff, rr(0.8, 1.4), 0.3, 12);
}
const flashes = [0, 1, 2].map(() => { const l = new THREE.PointLight(0xffc070, 0, 80, 1.2); scene.add(l); const g = glow(8, 0xffd9a0); scene.add(g); return { l, g, t: 0 }; });
let flashNext = 0;
function flash(pos, power = 60, color = 0xffc070, size = 8) {
  const f = flashes[flashNext = (flashNext + 1) % flashes.length];
  f.l.position.copy(pos); f.g.position.copy(pos); f.l.color.set(color); f.g.material.color.set(color); f.g.scale.setScalar(size); f.p = power; f.t = 1;
}

// ------------------------------------------------------------------ ships
export const ships = [];
class Ship {
  constructor(name, id, opts = {}) { Object.assign(this, { name, id, opts, state: 'away', doing: '' }); ships.push(this); job(async () => { this.obj = await make(id, true); scene.add(this.obj); this.ready = true; this.obj.visible = !!opts.visible; }); }
  get pos() { return this.obj.position; }
  pose(x, z, yaw, k = 1) {
    const y = (this.opts.lake ? -0.45 : WATER_Y + waveAt(x, z, T.sim) * 0.6 * k) - (this.opts.sink || 0);
    this.obj.position.set(x, y, z);
    this.obj.rotation.set(Math.sin(T.sim * 0.8 + x) * 0.035 * k, yaw, Math.sin(T.sim * 0.6 + z) * 0.05 * k, 'YXZ');
  }
  sail(points, speed, done) { this.curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => V(x, z))); this.u = 0; this.spd = speed; this.done = done; this.obj.visible = true; }
  step(dt, k = 1) {
    if (!this.curve) return;
    const L = this.curve.getLength(), ease = THREE.MathUtils.clamp(Math.min(this.u * 10 + 0.2, (1 - this.u) * 5), 0.3, 1);
    this.u = Math.min(1, this.u + dt * this.spd * ease / L);
    const p = this.curve.getPointAt(this.u), tg = this.curve.getTangentAt(Math.min(this.u, 0.999));
    this.pose(p.x, p.z, Math.atan2(tg.x, tg.z), k);
    if (this.u >= 1) { const d = this.done; this.curve = null; d && d(this); }
  }
  // a broadside: flashes, smoke and splashes along one side
  fire(side, at, n = 3) {
    const o = this.obj; o.updateMatrixWorld(true);
    for (let i = 0; i < n; i++) {
      const m = V(side * (this.opts.beam || 3.4), (i - (n - 1) / 2) * (this.opts.gunGap || 4), 2.2).applyMatrix4(o.matrixWorld);
      setTimeout(() => { flash(m, 70); puff(m, { size: 2.6, grow: 2, rise: 0.8, life: 6, color: 0xe8e8e8, opacity: 0.75, drift: 1.2 });
        for (let j = 0; j < 14; j++) fwSparks.emit(m.x, m.y, m.z, rr(-3, 3) + side * 6, rr(0, 3), rr(-3, 3), 0xffb050, rr(0.2, 0.5), 2, 2); }, i * 140);
      if (at) setTimeout(() => { const hit = rnd() < 0.25;
        if (hit) { const hp = at.clone().add(V(rr(-3, 3), rr(-8, 8), rr(2, 5))); flash(hp, 40, 0xff9040, 6); puff(hp, { size: 2, life: 7, color: 0x555555, opacity: 0.7 });
          for (let j = 0; j < 30; j++) fwSparks.emit(hp.x, hp.y, hp.z, rr(-6, 6), rr(2, 9), rr(-6, 6), 0xffa040, rr(0.4, 1), 1, 9); }
        else splash(at.x + rr(-14, 14), at.z + rr(-14, 14), 1.4); }, 900 + i * 200 + rr(0, 300));
    }
  }
}
export const galleon = new Ship('The big galleon', 'pirate-galleon-2e9aea', { visible: true, beam: 3.6, gunGap: 5 });
export const navy = new Ship('The navy galleon', 'pirate-galleon-2e9aea', { beam: 3.6, gunGap: 5 });
export const brig = new Ship('The pirate brigantine', 'pirate-brigantine-c29c57', { beam: 3, gunGap: 3.5 });
export const sloop = new Ship('The pirate sloop', 'pirate-sloop-d8ead0', { beam: 1.6, gunGap: 2 });
const rowboats = [[-8, 62, 0.4], [-9, 70, -0.2], [9, 58, 0.3]].map(([x, z, y]) => { const s = new Ship('a rowboat', 'rowboat-c42d85', { visible: true }); s.home = [x, z, y]; return s; });
sloop.docked = false;
shared.sloop = sloop;
export const DOCK = V(10.5, 74);

// fishing boats and the canoe carry a person
class Boat extends Ship {
  constructor(name, id, home, seat, clip, opts) { super(name, id, { visible: true, ...opts }); Object.assign(this, { home, seat, clip, state: 'moored' }); }
  board(p) {
    this.crew = p; p.board(this.obj, this.seat, this.clip); p.doing = this.opts.going; this.state = 'out';
    this.sail(this.opts.out(this), this.opts.speed, () => { this.state = 'working'; this.t0 = T.sim; p.anim.play(this.opts.workClip || this.clip); p.doing = this.opts.working; });
  }
  update(dt, h) {
    if (!this.ready) return;
    if (this.state === 'moored') this.pose(this.home[0], this.home[1], this.home[2], 0.5);
    else if (this.state === 'working') {
      const c = this.opts.ground, a = (T.sim - this.t0) * this.opts.drift;
      this.pose(c[0] + Math.cos(a) * c[2], c[1] + Math.sin(a) * c[2], -a, 1);
      if (!inH(h, ...this.opts.hours)) { this.state = 'back'; this.crew.doing = this.opts.returning;
        this.crew.anim.play(this.clip);
        this.sail([[this.pos.x, this.pos.z], ...this.opts.back(this)], this.opts.speed, () => {
          this.state = 'moored'; const p = this.crew; this.crew = null; p.ride = null;
          const s = this.opts.drop; p.pos.set(s[0], groundY(s[0], s[1]), s[1]); p.until = T.sim; p.plan = null; }); }
    } else this.step(dt, 1);
  }
}
export const boats = [0, 1].map(i => new Boat(i ? 'Corin\'s fishing boat' : 'Nell\'s fishing boat', 'small-fishing-boat-4ac0e3', [39.6, 64 + i * 12, 0], V(0, -1.4, 0.55), 'Idle', {
  speed: 5, drift: 0.04, hours: [5.2, 15.2], ground: [70 + i * 70, 170 + i * 25, 12], going: 'heading out to fish', working: 'hauling in the nets', returning: 'bringing the catch home',
  workClip: 'Fixing', drop: [36.4, 64 + i * 12],
  out: b => [[39.6, 64 + i * 12], [44, 100], [60 + i * 70, 150], [70 + i * 70 + 12, 170 + i * 25]], back: b => [[60 + i * 50, 140], [46, 100], [39.6, 64 + i * 12]] }));
export const canoe = new Boat('the canoe', 'wooden-canoe-1d00c5', [94, -66, 0.6], V(0, 0, 0.05), 'Sitting', {
  lake: true, speed: 1.6, drift: 0.05, hours: [8.5, 16], ground: [LAKE.x, LAKE.z, 15], going: 'paddling out onto the lake', working: 'paddling around the lake', returning: 'paddling back to shore',
  drop: [93, -63], out: b => [[94, -66], [102, -76], [LAKE.x + 15, LAKE.z]], back: b => [[100, -72], [94, -66]] });
shared.boats = boats; shared.canoe = canoe;

// ------------------------------------------------------------------ the hot air balloon
export const balloon = { ready: false, name: 'The hot air balloon', doing: '' };
job(async () => { balloon.obj = await make('hot-air-balloon-a2a511', true); scene.add(balloon.obj); balloon.ready = true;
  balloon.flame = glow(3.5, 0xffa040); scene.add(balloon.flame); balloon.top = new THREE.Box3().setFromObject(balloon.obj).max.y; });
Object.defineProperty(balloon, 'pos', { get() { return this.obj.position; } });
function updateBalloon(h) {
  if (!balloon.ready) return;
  const o = balloon.obj, start = [100, 30];
  if (inH(h, 5.5, 6.8)) { o.visible = true; o.position.set(start[0], groundY(...start), start[1]); balloon.doing = 'getting ready to take off'; balloon.flying = false; }
  else if (inH(h, 6.8, 11.5)) {
    const t = (h - 6.8) / 4.7; o.visible = true; balloon.flying = true; balloon.doing = 'drifting over Saltmeadow';
    o.position.set(start[0] - t * 420, groundY(...start) + 75 * THREE.MathUtils.smoothstep(t, 0, 0.12) + Math.sin(t * 9) * 4, start[1] - 60 * t + Math.sin(t * 5) * 30);
  } else { o.visible = false; balloon.flying = false; }
  o.rotation.y = T.sim * 0.03;
  const burn = o.visible && (Math.sin(T.sim * 0.7) > 0.3 || inH(h, 6.6, 7.2));
  balloon.flame.material.opacity = burn ? 0.9 + Math.sin(T.sim * 30) * 0.1 : 0;
  balloon.flame.position.set(o.position.x, o.position.y + balloon.top * 0.22, o.position.z);
}

// ------------------------------------------------------------------ dolphins
export const dolphins = { ready: false, list: [], active: 0, next: 30, at: V(0, 140), name: 'Dolphins', doing: 'leaping in the bay' };
job(async () => { for (let i = 0; i < 3; i++) { const d = await make('dolphin-base', true); d.visible = false; scene.add(d); dolphins.list.push({ obj: d, t: 9 }); } dolphins.ready = true; });
Object.defineProperty(dolphins, 'pos', { get() { return this.at; } });
function updateDolphins(dt, h) {
  if (!dolphins.ready) return;
  dolphins.next -= dt;
  if (dolphins.next <= 0 && inH(h, 6, 19.5)) {
    dolphins.next = rr(25, 70); dolphins.at = V(rr(-90, 90), rr(105, 160)); dolphins.yaw = rr(0, 6.28); dolphins.active = 6;
    dolphins.list.forEach((d, i) => { d.t = -i * 0.45 - rr(0, 0.2); d.x0 = dolphins.at.x + rr(-3, 3) - i * 2; d.z0 = dolphins.at.z + rr(-3, 3); d.jumps = 3; });
  }
  dolphins.active -= dt;
  for (const d of dolphins.list) {
    d.t += dt / 1.5;
    if (d.t < 0 || d.t > 1) { if (d.t > 1 && d.jumps > 1) { d.jumps--; d.t = -rr(0.3, 0.8); const dx = Math.sin(dolphins.yaw), dz = Math.cos(dolphins.yaw); d.x0 += dx * 12; d.z0 += dz * 12; } d.obj.visible = false; continue; }
    const dx = Math.sin(dolphins.yaw), dz = Math.cos(dolphins.yaw), t = d.t;
    d.obj.visible = true;
    d.obj.position.set(d.x0 + dx * t * 8, WATER_Y - 0.9 + Math.sin(t * Math.PI) * 3.2, d.z0 + dz * t * 8);
    d.obj.rotation.set(-Math.cos(t * Math.PI) * 0.9, dolphins.yaw, 0, 'YXZ');
    if (Math.abs(t - 0.06) < dt || Math.abs(t - 0.94) < dt) splash(d.obj.position.x, d.obj.position.z, 0.6);
  }
}

// ------------------------------------------------------------------ gulls and crows
const birds = [];
{
  const white = new THREE.MeshLambertMaterial({ color: 0xf4f4f4, side: THREE.DoubleSide }), dark = new THREE.MeshLambertMaterial({ color: 0x2a2a30, side: THREE.DoubleSide });
  for (let i = 0; i < 22; i++) {
    const crow = i >= 16, mat = crow ? dark : white, b = new THREE.Group();
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.8, 5).rotateX(Math.PI / 2), mat);
    const wl = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.32).translate(-0.5, 0, 0).rotateX(-Math.PI / 2), mat), wr = wl.clone(); wr.scale.x = -1;
    b.add(body, wl, wr);
    b.userData = { wl, wr, r: rr(14, 40), h: rr(12, 26), sp: rr(0.2, 0.4) * (rnd() < 0.5 ? 1 : -1), a: rr(0, 6.28), f: rr(6, 9),
      c: crow ? V(rr(55, 85), rr(20, 35)) : i < 10 ? V(rr(-10, 40), rr(60, 95)) : V(rr(-60, 60), rr(100, 160)) };
    birds.push(b); scene.add(b);
  }
}

// ------------------------------------------------------------------ fireworks
const rockets = [];
const PALETTE = [0xff4060, 0x40c0ff, 0xffe060, 0x80ff80, 0xff80ff, 0xffffff, 0xff9030, 0xa070ff];
export const fireworks = { on: false, at: V(0, 115, 30), name: 'Fireworks', doing: 'lighting up the harbour' };
Object.defineProperty(fireworks, 'pos', { get() { return this.at; } });
let fwNext = 0, fwLogged = -1;
function launch() {
  const x = rr(-30, 30), z = rr(100, 125);
  rockets.push({ p: V(x, z, 1), v: V(rr(-2, 2), rr(-2, 2), rr(26, 34)), fuse: rr(1.4, 2.1), color: pick(PALETTE), kind: pick(['sphere', 'sphere', 'ring', 'willow', 'double', 'crackle']) });
}
function burst(r) {
  const { x, y, z } = r.p, n = r.kind === 'willow' ? 160 : 220;
  flash(r.p, 120, r.color, 14);
  const c2 = pick(PALETTE), axis = V(rr(-1, 1), rr(-1, 1), rr(-1, 1)).normalize();
  for (let i = 0; i < n; i++) {
    let d = V(rr(-1, 1), rr(-1, 1), rr(-1, 1)); while (d.lengthSq() > 1 || d.lengthSq() < 0.01) d.set(rr(-1, 1), rr(-1, 1), rr(-1, 1));
    d.normalize();
    if (r.kind === 'ring') d.sub(axis.clone().multiplyScalar(d.dot(axis))).normalize();
    const sp = r.kind === 'willow' ? rr(9, 12) : rr(13, 17), col = r.kind === 'double' && i % 2 ? c2 : r.kind === 'willow' ? 0xffc860 : r.color;
    fwSparks.emit(x, y, z, d.x * sp, d.y * sp, d.z * sp, col, r.kind === 'willow' ? rr(2.6, 3.4) : rr(1.4, 2.2), r.kind === 'willow' ? 1.4 : 0.9, r.kind === 'willow' ? 3 : 5);
  }
  if (r.kind === 'crackle') setTimeout(() => { for (let i = 0; i < 120; i++) fwSparks.emit(x + rr(-12, 12), y + rr(-10, 8), z + rr(-12, 12), 0, 0, 0, 0xffffff, rr(0.1, 0.3), 0, 0); }, 900);
}
function updateFireworks(rdt, h) {
  fireworks.on = inH(h, ...shared.fireworks);
  if (fireworks.on) {
    const finale = h > shared.fireworks[1] - 0.12;
    fwNext -= rdt;
    if (fwNext <= 0) { launch(); if (finale) { launch(); launch(); } fwNext = finale ? rr(0.15, 0.35) : rr(0.4, 1.1); }
    if (fwLogged !== Math.floor(T.sim / 720)) { fwLogged = Math.floor(T.sim / 720); log('Fireworks over the harbour!'); shout(fireworks, 'The midsummer fireworks', 'Fireworks light up Saltmeadow harbour', 30, 'fireworks'); }
  }
  for (let i = rockets.length - 1; i >= 0; i--) {
    const r = rockets[i]; r.fuse -= rdt; r.v.y -= 6 * rdt; r.p.addScaledVector(r.v, rdt);
    fwSparks.emit(r.p.x, r.p.y, r.p.z, rr(-0.5, 0.5), rr(-1, 0), rr(-0.5, 0.5), 0xffd0a0, 0.5, 2, 2);
    if (r.fuse <= 0) { burst(r); rockets.splice(i, 1); }
  }
}

// ------------------------------------------------------------------ the sea battle
export const battle = { on: false, t: 0, name: 'A sea battle', doing: 'cannons roaring off the coast', at: V(0, 160) };
Object.defineProperty(battle, 'pos', { get() { return brig.ready ? brig.pos : this.at; } });
export function startBattle() {
  if (battle.on || !navy.ready || !brig.ready) return;
  battle.on = true; battle.t = 0; battle.shots = 0;
  brig.doing = 'running from the navy'; navy.doing = 'chasing the pirates';
  brig.sail([[-330, 190], [-160, 165], [0, 158], [140, 162], [220, 210], [320, 320]], 7, () => { brig.obj.visible = false; });
  navy.sail([[-360, 214], [-180, 186], [-10, 182], [130, 185], [230, 230], [380, 360]], 7, () => { navy.obj.visible = false; battle.on = false; });
  log('Cannon fire out at sea! The navy is chasing a pirate brigantine.');
  shout(battle, 'Cannons at sea', 'The navy galleon chases a pirate brigantine past Saltmeadow', 22, 'battle');
}
function updateBattle(dt, rdt) {
  if (!battle.on) return;
  battle.t += dt;
  brig.step(dt); navy.step(dt);
  battle.firing = brig.u > 0.18 && brig.u < 0.78;
  if (battle.firing) {
    battle.cool = (battle.cool ?? 2) - rdt;
    if (battle.cool <= 0) {
      battle.cool = rr(1.6, 3); battle.shots++;
      if (battle.shots % 2) navy.fire(1, brig.pos.clone(), 4); else brig.fire(-1, navy.pos.clone(), 3);
    }
  }
}

// ------------------------------------------------------------------ per frame
export function updateShow(dt, rdt, h) {
  if (galleon.ready && !battle.on) { const a = T.sim * 0.011, x = 40 + Math.cos(a) * 170, z = 250 + Math.sin(a) * 70;
    galleon.pose(x, z, Math.atan2(-Math.sin(a) * 170, Math.cos(a) * 70), 1.3); galleon.doing = 'sailing past the bay'; }
  for (const r of rowboats) if (r.ready) r.pose(...r.home, 1.6);
  for (const b of [...boats, canoe]) b.update(dt, h);
  updateBattle(dt, rdt);
  updateBalloon(h);
  updateDolphins(dt, h);
  updateFireworks(rdt, h);
  for (const f of flashes) { if (f.t > 0) { f.t = Math.max(0, f.t - rdt * 3); f.l.intensity = f.p * f.t * f.t; f.g.material.opacity = f.t; } }
  fwSparks.update(rdt); waterSparks.update(rdt);
  for (const b of birds) { const u = b.userData; u.a += u.sp * dt; const x = u.c.x + Math.cos(u.a) * u.r, z = u.c.z + Math.sin(u.a) * u.r;
    b.position.set(x, u.h + Math.sin(u.a * 3) * 1.2, z); b.rotation.y = Math.atan2(-Math.sin(u.a) * u.sp, Math.cos(u.a) * u.sp);
    const f = Math.sin(T.sim * u.f) * 0.6; u.wl.rotation.z = f; u.wr.rotation.z = -f; }
}
export { flash, splash };

// The automatic camera: picks something interesting, frames it, cuts away after a while; events can call it over.
import * as THREE from 'three';
import { camera, T, hourNow, inH, dayPart, rr, rnd, V, groundY, caption, director, FORT, LAKE } from './core.js';
import { people, animals, Person, Beast, ROLE_NAME, party, bear, fox, dog, caravanHorse } from './life.js';
import { ships, galleon, sloop, boats, canoe, balloon, dolphins, fireworks, battle } from './show.js';
import { light } from './world.js';

const posOf = s => s.pos || s.obj?.position || s.at;
function describe(s) {
  if (s instanceof Person) return [`${s.name}, ${s.role === 'pirate' ? (s.opts.captain ? 'pirate captain' : 'pirate deckhand') : ROLE_NAME[s.role]}`, s.doing];
  if (s instanceof Beast) return [s.name[0].toUpperCase() + s.name.slice(1), s.mood || (s.fly ? 'fluttering off' : s.goal ? (s.mul > 1.8 ? 'running!' : 'wandering about') : 'having a look around')];
  return [s.name || '', s.doing || ''];
}
const LANDMARKS = [
  { c: V(8, -6, 2), r: 150, y: 75, title: 'Saltmeadow', w: 2 },
  { c: V(12, 58, 2), r: 62, y: 24, title: 'The harbour', w: 1.6 },
  { c: V(66, 6, 2), r: 50, y: 22, title: 'Mara\'s farm', w: 1.2, day: true },
  { c: V(FORT.x, FORT.z, FORT.h + 4), r: 58, y: FORT.h + 24, title: 'The hill fort', w: 1.2 },
  { c: V(LAKE.x, LAKE.z, 1), r: 56, y: 18, title: 'The mill pond', w: 1, day: true },
  { c: V(-4, 2, 2), r: 22, y: 9, title: 'Market square', w: 1.5, day: true },
  { c: V(-110, 0, 4), r: 70, y: 30, title: 'The old forest', w: 0.8, day: true },
  { c: V(-121, 28, 1), r: 12, y: 5, title: 'A hiker\'s camp', w: 2.5, night: true },
];
const FLYOVERS = [
  { pts: [[-220, -40, 45], [-90, 0, 30], [0, 10, 26], [60, 60, 30], [130, 150, 42]], title: 'Over Saltmeadow' },
  { pts: [[40, 180, 28], [10, 60, 24], [0, -40, 30], [0, -130, 38], [0, -240, 60]], title: 'From the sea to the fort' },
  { pts: [[180, -130, 34], [112, -84, 22], [70, -20, 22], [30, 40, 26], [-40, 90, 34]], title: 'Lake, farm and shore' },
].map(f => ({ ...f, curve: new THREE.CatmullRomCurve3(f.pts.map(([x, z, y]) => V(x, z, y))) }));

function chooseShot(now) {
  const h = hourNow(), sp = director.spotlight;
  if (sp && sp.until > now) {
    sp.fresh = false;
    const s = sp.subject, thing = !(s instanceof Person) && !(s instanceof Beast);
    const kind = sp.kind === 'fireworks' || s === fireworks ? 'fireworks' : sp.kind === 'wide' ? 'orbit' : thing ? 'ship' : 'follow';
    const o = { kind, subj: s, end: sp.until, a: rr(0, 6.28), title: sp.text, sub: sp.sub, far: s === battle || s === dolphins };
    if (kind === 'orbit') Object.assign(o, { c: V(8, -6, 2), r: 120, y: 55 });
    return o;
  }
  const opts = [];
  const add = (w, o) => w > 0 && opts.push([w, o]);
  const vis = people.filter(p => p.ready && !p.hidden);
  for (const p of vis) add((p.moving ? 0.8 : 1.6) * (p.role === 'pirate' ? 2 : 1), { kind: rnd() < 0.25 && p.moving ? 'dolly' : rnd() < 0.15 ? 'crane' : 'follow', subj: p });
  for (const L of LANDMARKS) add(L.w * (L.day && light.day < 0.3 ? 0.1 : 1) * (L.night ? 1 - light.day : 1), { kind: 'orbit', ...L, sub: dayPart(h) });
  if (party(h)) add(8, { kind: 'orbit', c: V(9, 8, 1.4), r: 13, y: 5, title: 'The bonfire party', sub: 'Saltmeadow at night' });
  if (fireworks.on) add(30, { kind: 'fireworks', subj: fireworks });
  for (const a of animals) if (a.ready && a.obj.visible) add(a === bear || a === fox ? 1.2 : a === dog ? 0.8 : a.name === 'a pigeon' ? 0.03 : 0.15, { kind: 'follow', subj: a, close: true });
  for (const s of ships) if (s.ready && s.obj.visible && (s === galleon || s.state !== 'moored')) add(s === galleon ? 0.6 : 1.4, { kind: 'ship', subj: s });
  if (balloon.flying) add(3, { kind: 'ship', subj: balloon });
  if (dolphins.active > 0) add(6, { kind: 'ship', subj: dolphins, far: true });
  if (battle.on) add(battle.firing ? 40 : 10, { kind: 'ship', subj: battle, far: true });
  if (light.day > 0.5) for (const f of FLYOVERS) add(1, { kind: 'fly', ...f, sub: dayPart(h) });
  let tot = opts.reduce((s, o) => s + o[0], 0), r = rnd() * tot;
  for (const [w, o] of opts) if ((r -= w) <= 0) { o.end = now + (o.kind === 'fly' ? 18 : rr(9, 14)); o.a = rr(0, 6.28); return o; }
  return { kind: 'orbit', c: V(8, -6, 2), r: 140, y: 70, end: now + 10, a: 0, title: 'Saltmeadow' };
}

let shot = null;
export const camLook = new THREE.Vector3(0, 2, 0);
const want = new THREE.Vector3(), wantLook = new THREE.Vector3();
export function nextShot() { shot = null; }
export function direct(rdt) {
  const now = T.real;
  if (!shot || now > shot.end || director.spotlight?.fresh) { shot = chooseShot(now); shot.t0 = now; shot.cut = true; }
  const t = now - shot.t0, dur = shot.end - shot.t0;
  let k = 2.5;
  if (shot.kind === 'orbit') {
    const a = shot.a + t * (shot.r > 90 ? 0.022 : shot.r > 30 ? 0.045 : 0.09);
    want.set(shot.c.x + Math.cos(a) * shot.r, shot.c.y + shot.y, shot.c.z + Math.sin(a) * shot.r);
    wantLook.copy(shot.c);
    caption(shot.title, shot.sub);
  } else if (shot.kind === 'fly') {
    const u = Math.min(1, t / dur), p = shot.curve.getPointAt(u), q = shot.curve.getPointAt(Math.min(1, u + 0.06));
    want.copy(p); wantLook.copy(q).add(V(0, 0, -10)); k = 6;
    caption(shot.title, shot.sub);
  } else if (shot.kind === 'fireworks') {
    want.set(-26 + Math.sin(t * 0.05) * 8, 5, 34); wantLook.set(0, 24, 112);
    caption('Fireworks over the harbour', 'Midsummer night');
  } else {
    const s = shot.subj, p = posOf(s);
    if (!p || (s instanceof Person && s.hidden && !shot.title)) { shot.end = Math.min(shot.end, now + 0.6); return; }
    if (shot.kind === 'ship') {
      const d = shot.far ? 75 : 42, a = shot.a + t * 0.05;
      want.set(p.x + Math.cos(a) * d, p.y + (shot.far ? 30 : 16), p.z + Math.sin(a) * d); wantLook.set(p.x, p.y + 4, p.z);
    } else if (shot.kind === 'dolly') {
      const yaw = s.obj.rotation.y, side = shot.a > 3.14 ? 1 : -1;
      want.set(p.x + Math.cos(yaw) * 5 * side, p.y + 1.5, p.z - Math.sin(yaw) * 5 * side); wantLook.set(p.x, p.y + 1.1, p.z); k = 5;
    } else if (shot.kind === 'crane') {
      const u = THREE.MathUtils.smoothstep(t / dur, 0, 1), d = 5 + u * 38, a = shot.a + t * 0.05;
      want.set(p.x + Math.cos(a) * d, p.y + 1.4 + u * 30, p.z + Math.sin(a) * d); wantLook.set(p.x, p.y + 1.2 - u * 0.5, p.z);
    } else {
      const close = shot.close, d = close ? 6 : 8, hh = close ? 2.6 : 3.4, a = shot.a + t * 0.11;
      want.set(p.x + Math.cos(a) * d, p.y + hh, p.z + Math.sin(a) * d); wantLook.set(p.x, p.y + (close ? 0.5 : 1.2), p.z);
    }
    const [title, doing] = describe(s);
    if (shot.title && t < 6) caption(shot.title, shot.sub); else caption(doing ? `${title} · ${doing}` : title, dayPart(hourNow()));
  }
  const floor = Math.max(groundY(want.x, want.z), -0.3) + 1.2;
  if (want.y < floor) want.y = floor;
  if (shot.cut) { camera.position.copy(want); camLook.copy(wantLook); shot.cut = false; }
  else { camera.position.lerp(want, 1 - Math.exp(-k * rdt)); camLook.lerp(wantLook, 1 - Math.exp(-5 * rdt)); }
  camera.lookAt(camLook);
}

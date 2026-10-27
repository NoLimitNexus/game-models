// Loads everything, then runs the town.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { renderer, composer, camera, T, hourNow, dayNow, clockText, jobs, updatePuffs, director, shout, placed, log } from './core.js';
import { plantAll, finishWorld, updateWorld } from './world.js';
import { people, animals, runTimers, disturbBirds, party, caravanHorse, pirates } from './life.js';
import { updateShow, sloop, galleon, battle, fireworks, balloon, dolphins, boats, canoe } from './show.js';
import { updateEvents } from './events.js';
import { direct, camLook, nextShot } from './director.js';

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.49; controls.enabled = false;
let auto = true;
const camBtn = document.getElementById('camBtn');
function setAuto(on) { auto = on; controls.enabled = !on; camBtn.classList.toggle('on', on); camBtn.textContent = on ? 'Auto camera' : 'Free camera';
  if (!on) controls.target.copy(camLook); else nextShot(); }
camBtn.onclick = () => setAuto(!auto);
document.getElementById('nextBtn').onclick = () => { setAuto(true); nextShot(); };
renderer.domElement.addEventListener('pointerdown', () => { if (auto) setAuto(false); });
document.querySelectorAll('[data-speed]').forEach(b => b.onclick = () => { T.speed = +b.dataset.speed;
  document.querySelectorAll('[data-speed]').forEach(x => x.classList.toggle('on', x === b)); });

const clockEl = document.getElementById('clock');
const prof = { people: 0, animals: 0, show: 0, world: 0, render: 0, n: 0 };
const clock = new THREE.Clock();
let paused = false;
function frame(fixed) {
  if (paused && !fixed) return;
  const rdt = fixed || Math.min(clock.getDelta(), 0.05), dt = rdt * T.speed;
  T.sim += dt; T.real += rdt;
  const h = hourNow();
  const P = prof, t0 = performance.now();
  runTimers();
  updateEvents(dt, h);
  const cp = camera.position;
  for (const p of people) p.update(dt, !p.obj || p.obj.position.distanceToSquared(cp) < 160 * 160);
  const t1 = performance.now();
  for (const a of animals) a.update(dt, !a.obj || a.obj.position.distanceToSquared(cp) < 130 * 130);
  disturbBirds();
  const t2 = performance.now();
  updateShow(dt, rdt, h);
  updatePuffs(rdt * Math.min(T.speed, 3));
  if (auto) direct(rdt); else { controls.update(); camLook.copy(controls.target); }
  const t3 = performance.now();
  updateWorld(dt, rdt, h, camLook, party(h));
  clockEl.textContent = `Day ${dayNow()} · ${clockText(h)}`;
  const t4 = performance.now();
  composer.render();
  const t5 = performance.now();
  P.people += t1 - t0; P.animals += t2 - t1; P.show += t3 - t2; P.world += t4 - t3; P.render += t5 - t4; P.n++;
}

(async () => {
  plantAll();
  let n = 0;
  while (n !== jobs.length) { n = jobs.length; await Promise.all(jobs.slice()); }
  finishWorld();
  for (const p of people) if (p.ready && !p.hidden) { p.until = 0; p.think(); }
  if (caravanHorse.ready) caravanHorse.obj.visible = false;
  if (placed.jollyRoger) placed.jollyRoger.visible = false;
  document.getElementById('loading').style.opacity = '0';
  setTimeout(() => document.getElementById('loading').remove(), 1100);
  log('Welcome to Saltmeadow. Everyone is going about their business.');
  renderer.setAnimationLoop(() => frame());
  window.SM = { battle, fireworks, balloon, dolphins, boats, canoe, pause(v = true) { paused = v; }, prof, renderer, people, animals, sloop, galleon, T, director, shout, nextShot,
    async step(secs, sp = 1) { const s0 = T.speed; T.speed = sp; for (let i = 0; i < secs * 30; i++) { frame(1 / 30); for (let k = 0; k < 4; k++) await null; } T.speed = s0; },
    look(subj, secs = 30) { setAuto(true); shout(subj, 'test', 'test', secs); } };
})();

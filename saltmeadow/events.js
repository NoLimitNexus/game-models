// The day's stories: bear raid, pirate visit (salute, brawl, buried treasure), fox at the coop, rain and rainbow, the caravan, the sea battle.
import * as THREE from 'three';
import { scene, T, hourNow, dayNow, inH, rr, rnd, pick, V, make, job, log, shout, puff, groundY, placed, START_HOUR } from './core.js';
import { startRain, weather } from './world.js';
import { people, pirates, bear, fox, dog, chickens, mara, hollis, odo, pip, bram, trader, caravanHorse, shared, wait, SPOTS, party } from './life.js';
import { sloop, DOCK, startBattle, fwSparks, flash } from './show.js';

const plan = { day: 0 };
function newDay() {
  const d = dayNow(), first = d === 1;
  Object.assign(plan, {
    day: d,
    bear: first ? START_HOUR + 0.4 : rnd() < 0.65 ? rr(9.5, 14.5) : null,
    pirates: first ? 16.3 : rnd() < 0.8 ? rr(15.8, 17) : null,
    battle: first ? 18.4 : rnd() < 0.55 ? rr(10.5, 15.5) : null,
    rain: first ? null : rnd() < 0.45 ? rr(8, 16) : null,
    caravan: rnd() < 0.85 || first ? 8.4 : null,
    fox: rr(1.6, 3.8),
    brawl: 19.4, bury: 23.7, find: rr(8.8, 9.6),
    done: {},
  });
  plan.dawnLog = !first;
}
const once = (k, h, at) => at != null && h >= at && !plan.done[k] && (plan.done[k] = true);

// anyone near the bear runs home shouting
const SCREAMS = ['BEAR!!', 'Run!!', 'Aaah!', 'Not again!', 'Mind the bear!', 'Somebody get Hollis!'];
function panic() {
  if (!bear.inTown) return;
  for (const p of people) {
    if (!p.ready || p.hidden || p.busy || p.ride || p.fleeing || ['guard', 'knight', 'pirate'].includes(p.role)) continue;
    if (p.pos.distanceTo(bear.pos) < 16) {
      p.fleeing = true;
      p.start({ spot: 'home', run: true, hide: true, dur: 25, moveText: 'running from the bear!', say: p.role === 'kid' ? pick(['A BEAR! Cool!', 'Run!!']) : pick(SCREAMS),
        onArrive: () => setTimeout(() => p.fleeing = false, 8000) });
    }
  }
}

// a cloud of angry bees around the bear
const bees = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(70 * 3), 3)),
  new THREE.PointsMaterial({ color: 0x2a2100, size: 0.16 }));
bees.visible = false; bees.frustumCulled = false; scene.add(bees);
function updateBees() {
  if (!bees.visible) return;
  const p = bees.geometry.attributes.position, c = bear.pos;
  for (let i = 0; i < 70; i++) { const a = T.real * (3 + i % 5) + i, r = 0.8 + (i % 7) * 0.25;
    p.setXYZ(i, c.x + Math.cos(a) * r, c.y + 1.2 + Math.sin(a * 1.7) * 0.7, c.z + Math.sin(a) * r); }
  p.needsUpdate = true;
}

async function bearStory() {
  bear.held = true; bear.mood = 'lumbering out of the forest';
  log('Something big is crashing through the forest...');
  shout(bear, 'Something is coming', 'A black bear is heading for the village', 14);
  if (bear.pos.x < -125) bear.pos.set(-125, groundY(-125, -10), -10);   // start at the edge of the trees
  await bear.go([[-80, 8], [-58, 4], [-30, 0]], 3.2);
  bear.inTown = true; bear.mood = 'heading straight for the market';
  await bear.go([[-8, 4]], 2.6);
  bear.mood = 'raiding the fish stall!'; bear.say('*munch munch*', 4);
  if (placed.stall0) placed.stall0.rotation.z = 0.22;
  if (!odo.hidden) odo.say('MY FISH!!', 4);
  log('The bear is raiding Odo\'s fish stall!');
  shout(bear, 'Market raid', 'The bear helps itself to Odo\'s fish', 12);
  hollis.busy = true;
  await hollis.go({ spot: 'bearSpot', run: true, act: 'Punch', dur: 99, exact: true, look: [-8, 4], say: 'OI! You! Shoo!', moveText: 'charging at the bear', text: 'squaring up to the bear' });
  shout(hollis, 'Hollis vs. the bear', 'Hollis the guard squares up to the bear', 10);
  hollis.say('Go on! Get out of it!', 3); await wait(2.5);
  hollis.act('Kick', 99, 'shooing the bear away!'); bear.say('GRRR!', 2);
  await wait(3);
  bear.mood = 'running off... toward the beehives?';
  log('Hollis chases the bear out of the market... straight toward Mara\'s beehives.');
  hollis.say('And STAY out!', 3); hollis.act('Agree', 4, 'very pleased with the result');
  setTimeout(() => { hollis.busy = false; }, 1500);
  await bear.go([[8, 2], [30, 0], [46, 4], [46, 22], [41.5, 27]], 2.6);
  bear.mood = 'stealing honey from the beehives'; bear.say('Mmm, honey', 3);
  shout(bear, 'Sweet tooth', 'The bear has found the beehives', 12);
  await wait(5);
  bees.visible = true; bear.say('OW! OW!', 3);
  bear.mood = 'fleeing a swarm of angry bees!';
  log('The bees are NOT happy. The bear runs for the woods!');
  shout(bear, 'Bad idea', 'A swarm of angry bees chases the bear home', 12);
  await bear.go([[46, 4], [30, 0], [0, -2], [-30, 0], [-58, 4], [-80, 8], [-125, -12]], 5);
  bees.visible = false; bear.inTown = false; bear.held = false; bear.mood = null;
  log('The bear makes it home, sticky and sore.');
}

async function pirateArrival() {
  sloop.state = 'in';
  sloop.doing = 'making for the harbour';
  log('Sails on the horizon: a pirate sloop is heading for the harbour!');
  shout(sloop, 'Ship ahoy', 'A pirate sloop is making for Saltmeadow harbour', 20);
  sloop.sail([[-220, 260], [-120, 190], [-50, 135], [10.5, 104], [DOCK.x, DOCK.z]], 9, async () => {
    sloop.state = 'docked'; sloop.docked = true; sloop.leaving = false; sloop.doing = 'tied up at the pier';
    if (placed.jollyRoger) placed.jollyRoger.visible = true;
    for (let i = 0; i < 3; i++) setTimeout(() => sloop.fire(1, null, 1), i * 1100);
    log('BOOM! BOOM! BOOM! The pirates fire a salute as they tie up.');
    for (const p of people) if (p.ready && !p.hidden && !p.busy && !p.ride && p.pos.distanceTo(DOCK) < 45 && p.role !== 'pirate') p.say(pick(['Pirates!', 'Hide the silver!', 'Oh no, not them again.', 'Lock up the rum!']), 3);
    await wait(2);
    pirates.forEach((p, i) => { p.aboard = false; p.hidden = false; p.obj.visible = true; p.pos.set(2.2, 0.55, DOCK.z - 1 + i * 1.3); p.until = T.sim + i * 2; p.plan = null; p.spotKey = null; });
    pirates[0].say('Ahoy, Saltmeadow! Where\'s the rum?', 4);
    shout(pirates[0], 'Visitors', 'Captain Redd steps ashore, looking for the tavern', 12);
  });
}

async function brawl() {
  const g = pirates[1];
  const retry = () => { if (hourNow() < 20) { plan.brawl = hourNow() + 0.2; plan.done.brawl = false; } };
  if (!g.ready || g.hidden || g.busy || g.moving || g.pos.distanceTo(V(SPOTS.drink.x, SPOTS.drink.z)) > 8) return retry();
  const foe = people.find(p => p.ready && !p.hidden && !p.busy && !p.ride && !p.moving && p.role !== 'pirate' && p.role !== 'guard' && p.pos.distanceTo(g.pos) < 9) || null;
  if (!foe) return retry();
  g.busy = foe.busy = true;
  const mid = g.pos.clone().add(foe.pos).multiplyScalar(0.5);
  g.say('Oi! That\'s MY stool!', 3);
  await foe.go({ spot: { x: g.pos.x + 1.7, z: g.pos.z, node: 'plaza', look: [g.pos.x, g.pos.z] }, exact: true, direct: true, act: 'Head shake', dur: 99, say: 'Says who?' });
  g.lookYaw = Math.atan2(foe.pos.x - g.pos.x, foe.pos.z - g.pos.z);
  log(`A brawl breaks out at the tavern: Gully the pirate vs. ${foe.name}!`);
  shout(g, 'Tavern brawl', `Gully the pirate and ${foe.name} come to blows`, 16);
  for (const p of people) if (p !== g && p !== foe && p.ready && !p.hidden && !p.busy && !p.ride && p.pos.distanceTo(mid) < 12) { p.act('Laughing', 12); p.say(pick(['Fight! Fight!', 'Get him!', 'Ooh!', 'My money\'s on the pirate!']), 3); }
  for (let i = 0; i < 4; i++) { g.act(i % 2 ? 'Kick' : 'Punch', 99, 'brawling!'); foe.act(i % 2 ? 'Punch' : 'Kick', 99, 'brawling!'); await wait(2); }
  hollis.busy = true;
  await hollis.go({ spot: { x: mid.x, z: mid.z - 1.8, node: 'plaza', look: [mid.x, mid.z] }, run: true, exact: true, act: 'Head shake', dur: 99, say: 'BREAK IT UP!', moveText: 'running to break up the fight' });
  hollis.say('Not in MY town!', 3);
  await wait(2);
  g.act('Agree', 4, 'making up'); foe.act('Agree', 4, 'making up'); g.say('...sorry.', 2); foe.say('Fine. Sorry.', 2);
  await wait(3);
  g.say('Rum\'s on me!', 3); log('Peace is restored. The rum is on Gully.');
  g.busy = foe.busy = hollis.busy = false; g.until = foe.until = hollis.until = T.sim;
}

let chest = null;
job(async () => { chest = await make('treasure-chest-c2ac4f', true); chest.visible = false; scene.add(chest);
  chest.userData.lid = chest.getObjectByName('lid') || chest.getObjectByName('Lid'); });
const chestGlow = new THREE.PointLight(0xffd060, 0, 10, 1.5); scene.add(chestGlow);
let buried = false;
async function bury() {
  const [cap, fenn] = [pirates[0], pirates[2]];
  if (!cap.ready || cap.hidden || fenn.hidden || !chest) return;
  cap.busy = fenn.busy = true;
  log('Captain Redd and Fenn sneak off toward the beach with something heavy...');
  const t = SPOTS.treasure;
  chest.visible = true; fenn.carrying = chest;
  fenn.start({ spot: 'treasure', carry: true, speed: 2, act: 'Crouch', dur: 99, exact: true, moveText: 'lugging a mysterious chest', text: 'digging a hole' });
  await cap.go({ spot: { x: t.x - 1.4, z: t.z, node: 'beachW', look: [t.x, t.z] }, speed: 2, exact: true, act: 'Crouch', dur: 99, moveText: 'sneaking to the beach', text: 'digging a hole', say: 'Quietly now...' });
  while (fenn.moving) await wait(0.5);
  fenn.carrying = null;
  chest.position.set(t.x, groundY(t.x, t.z), t.z + 1);
  shout(cap, 'Buried treasure', 'Captain Redd and Fenn bury a chest on the beach', 14);
  for (let i = 0; i < 12; i++) { await wait(0.8); puff(V(t.x, t.z + 1, groundY(t.x, t.z) + 0.3), { size: 0.6, color: 0xe4d09a, opacity: 0.6, life: 2, rise: 0.5 }); chest.position.y -= 0.1; }
  chest.visible = false; buried = true;
  cap.say('Not a word of this, Fenn.', 3); fenn.say('Aye, Cap\'n.', 3);
  log('The chest is buried. The pirates swear each other to secrecy.');
  await wait(3);
  cap.busy = fenn.busy = false; cap.until = fenn.until = T.sim;
}
async function findTreasure() {
  if (!buried || !pip.ready || pip.busy || pip.hidden || !chest) return;
  buried = false; pip.busy = true;
  const t = SPOTS.treasure;
  log('Pip has spotted a strange lump in the sand...');
  await pip.go({ spot: { x: t.x, z: t.z, node: 'beachW', look: [t.x, t.z + 1] }, exact: true, run: true, act: 'Crouch', dur: 99, say: 'What\'s this?', text: 'digging in the sand' });
  shout(pip, 'Finders keepers', 'Pip is digging on the beach...', 16);
  chest.visible = true; chest.position.set(t.x, groundY(t.x, t.z) - 1.1, t.z + 1);
  for (let i = 0; i < 10; i++) { await wait(0.7); chest.position.y += 0.11; puff(V(t.x, t.z + 1, groundY(t.x, t.z) + 0.3), { size: 0.6, color: 0xe4d09a, opacity: 0.6, life: 2, rise: 0.5 }); }
  if (chest.userData.lid) chest.userData.lid.rotation.x = -1.3;
  chestGlow.position.set(t.x, groundY(t.x, t.z) + 1.2, t.z + 1); chestGlow.intensity = 12;
  for (let i = 0; i < 80; i++) fwSparks.emit(t.x + rr(-0.4, 0.4), groundY(t.x, t.z) + 0.8, t.z + 1 + rr(-0.3, 0.3), rr(-1.5, 1.5), rr(3, 6), rr(-1.5, 1.5), 0xffd060, rr(0.8, 1.6), 0.6, 6);
  pip.act('Dance', 99, 'dancing around a chest of pirate gold'); pip.say('TREASURE!!!', 4);
  log('Pip has dug up a chest of pirate gold!');
  for (const k of people.filter(p => p.role === 'kid' && p !== pip && p.ready && !p.busy)) {
    k.busy = true; k.go({ spot: { x: t.x + rr(-2.5, 2.5), z: t.z + rr(-1, 2), node: 'beachW', look: [t.x, t.z + 1] }, run: true, exact: true, act: 'Dance', dur: 99, say: 'We\'re RICH!' });
  }
  await wait(30);
  chestGlow.intensity = 0;
  for (const k of people.filter(p => p.role === 'kid')) { k.busy = false; k.until = T.sim; }
}

async function foxStory() {
  fox.held = true; fox.mood = 'sneaking toward the chickens';
  log('A fox slips out of the woods toward Mara\'s farm...');
  shout(fox, 'Midnight prowler', 'A fox is creeping toward the chicken coop', 14);
  if (fox.pos.x < -75) fox.pos.set(-75, groundY(-75, 5), 5);   // start at the edge of the trees
  await fox.go([[-58, 4], [-30, 0], [30, 0], [46, 4], [46, 13]], 2.6);
  fox.mood = 'pouncing on the chicken coop!';
  for (const c of chickens) if (c.ready && c.pos.distanceTo(fox.pos) < 14) { c.flee(fox.pos, 1.6); if (rnd() < 0.4) c.say('BAWK!', 2); }
  log('Chickens everywhere! Rufus wakes up barking.');
  shout(dog, 'Chaos at the coop', 'Rufus to the rescue!', 14);
  dog.held = true; dog.mood = 'charging at the fox!'; dog.say('WOOF! WOOF!', 3);
  if (mara.ready) { mara.busy = true; mara.lightOn = true;
    mara.go({ spot: 'coopYard', run: true, act: 'Holding lantern', dur: 99, say: 'Who\'s there?!', moveText: 'running out with a lantern', text: 'holding up a lantern' }); }
  await dog.go([[fox.pos.x + 1.5, fox.pos.z + 1.5]], 3);
  fox.mood = 'running for its life!'; fox.say('Yip!', 2);
  fox.go([[30, 0], [-30, 0], [-58, 4], [-100, -10]], 3.4).then(() => { fox.held = false; fox.mood = null; });
  await dog.go([[30, 0], [12, 1]], 3); dog.say('Woof!', 2); dog.mood = 'trotting home, very proud';
  await wait(3);
  dog.held = false; dog.mood = null;
  if (mara.ready) { mara.say('Good boy, Rufus.', 3); await wait(3); mara.act('Head shake', 3, 'counting the chickens'); await wait(3);
    mara.lightOn = undefined; mara.busy = false; mara.until = T.sim; }
  log('Not a feather lost. Rufus gets an extra bone.');
}

async function rainStory(h) {
  startRain(h);
  log('Dark clouds roll in off the sea...');
  await wait(4);
  shared.rainRun = true;
  log('Rain! Everyone runs for cover.');
  shout({ pos: V(0, 0, 1.5), name: 'Saltmeadow' }, 'Downpour', 'Rain lashes Saltmeadow. Everyone runs for cover.', 12, 'wide');
  for (const p of people) {
    if (!p.ready || p.hidden || p.busy || p.ride) continue;
    if (p.role === 'kid') { p.act('Dance', 14, 'splashing in puddles'); p.say(pick(['Puddles!!', 'Wheee!', 'I love rain!']), 3); }
    else if (!p.opts.braveRain) p.start({ spot: 'home', run: true, hide: true, dur: 30, moveText: 'running out of the rain', say: pick(['My hair!', 'Ugh, rain!', 'Run!', 'Not my washing!']) });
  }
  while (hourNow() < weather.rainUntil - 0.05) await wait(2);
  shared.rainRun = false;
  weather.rainbowUntil = hourNow() + 1.6;
  log('The rain stops, and a rainbow appears.');
  shout({ pos: V(0, -20, 1.5), name: 'Saltmeadow' }, 'After the rain', 'A rainbow over Saltmeadow', 14, 'wide');
}

// the caravan: a horse pulling a wagon down the east road, with Vesk at the reins
let wagon = null;
job(async () => { wagon = await make('four-wheel-wagon-adb946', true); wagon.visible = false; scene.add(wagon); });
const SEAT = V(0, 0.6, 1.35);
async function caravanStory() {
  if (!caravanHorse.ready || !wagon || !trader.ready) return;
  const h = caravanHorse;
  if (inH(hourNow(), 11.5, 16.2)) {      // already in town when the show starts
    h.pos.set(27, groundY(27, 7), 7); h.obj.rotation.y = -2.2; h.obj.visible = wagon.visible = true; updateWagon(1);
    wagon.position.set(27 + Math.sin(2.2) * 4.4, groundY(30, 10), 7 + Math.cos(2.2) * 4.4); wagon.rotation.y = -2.2;
    shared.caravanHere = true; h.mood = 'resting by the plaza'; trader.hidden = false; trader.obj.visible = true;
    trader.pos.set(SPOTS.caravan.x, 0, SPOTS.caravan.z); trader.until = T.sim; return;
  }
  h.pos.set(220, groundY(220, 10), 10); h.obj.visible = true; wagon.visible = true;
  trader.board(wagon, SEAT, 'Driving'); trader.doing = 'driving the caravan into town';
  h.mood = 'pulling the merchant\'s wagon';
  log('A merchant caravan is rolling down the east road!');
  shout(h, 'A caravan arrives', 'Vesk the travelling merchant is coming to town', 14);
  await h.go([[170, 10], [127, 6], [100, 4], [62, 12], [48, 2], [32, 1], [27, 7]], 1.3);
  shared.caravanHere = true; h.mood = 'resting by the plaza';
  trader.ride = null; trader.pos.set(SPOTS.caravan.x, 0, SPOTS.caravan.z); trader.until = T.sim; trader.plan = null;
  log('The caravan sets up by the plaza. Silks! Spices! Strange trinkets!');
  shout(trader, 'Market day', 'Vesk opens up the caravan by the plaza', 12);
}
async function caravanLeaves() {
  if (!shared.caravanHere) return;
  shared.caravanHere = false;
  trader.busy = true;
  await trader.go({ spot: 'caravan', exact: true, act: 'Idle', dur: 2 });
  trader.board(wagon, SEAT, 'Driving'); trader.doing = 'heading off down the east road';
  log('Vesk packs up the caravan and heads east.');
  caravanHorse.mood = 'pulling the wagon out of town';
  await caravanHorse.go([[48, 2], [62, 12], [100, 4], [127, 6], [170, 10], [240, 10]], 1.3);
  caravanHorse.obj.visible = wagon.visible = false; trader.ride = null; trader.hidden = true; trader.obj.visible = false; trader.busy = false;
}
function updateWagon(dt) {
  if (!wagon?.visible || !caravanHorse.ready) return;
  const h = caravanHorse.obj, yaw = h.rotation.y, bx = h.position.x - Math.sin(yaw) * 4.4, bz = h.position.z - Math.cos(yaw) * 4.4;
  wagon.position.x += (bx - wagon.position.x) * Math.min(1, dt * 6); wagon.position.z += (bz - wagon.position.z) * Math.min(1, dt * 6);
  wagon.position.y = groundY(wagon.position.x, wagon.position.z);
  wagon.rotation.y = Math.atan2(h.position.x - wagon.position.x, h.position.z - wagon.position.z);
}

// ------------------------------------------------------------------ per frame
export function updateEvents(dt, h) {
  if (plan.day !== dayNow()) newDay();
  if (once('bear', h, plan.bear) && h < 17) bearStory();
  if (once('pirates', h, plan.pirates) && sloop.ready && sloop.state === 'away') pirateArrival();
  if (once('battle', h, plan.battle)) startBattle();
  if (once('rain', h, plan.rain)) rainStory(h);
  if (once('caravan', h, plan.caravan) && h < 16) caravanStory();
  if (once('caravanGo', h, 16.2)) caravanLeaves();
  if (once('fox', h, plan.fox) && h < 5) foxStory();
  if (once('brawl', h, plan.brawl) && sloop.docked) brawl();
  if (once('bury', h, plan.bury) && sloop.docked) bury();
  if (once('find', h, plan.find)) findTreasure();
  if (once('resetStall', h, 6) && placed.stall0) placed.stall0.rotation.z = 0;
  if (plan.dawnLog && once('dawn', h, 5.4)) log(`Dawn breaks over Saltmeadow. Day ${plan.day}.`);
  if (sloop.state === 'docked' && inH(h, 1.5, 6) && !sloop.leaving) sloop.leaving = true;
  if (sloop.state === 'docked' && sloop.leaving && (pirates.every(p => p.aboard) || inH(h, 4, 6))) {
    sloop.state = 'out'; sloop.docked = false; sloop.doing = 'slipping out to sea';
    for (const p of pirates) { p.aboard = true; p.hidden = true; p.obj.visible = false; p.busy = false; }
    if (placed.jollyRoger) placed.jollyRoger.visible = false;
    log('The pirates stagger aboard and the sloop slips out into the night.');
    shout(sloop, 'Fair winds', 'The pirates sail off into the dark', 14);
    sloop.sail([[DOCK.x, DOCK.z], [14, 100], [70, 150], [170, 220], [330, 330]], 7, () => { sloop.state = 'away'; sloop.obj.visible = false; });
  }
  if (sloop.ready) { if (sloop.state === 'docked') sloop.pose(DOCK.x, DOCK.z, Math.PI, 0.5); else if (sloop.state !== 'away') sloop.step(dt); else sloop.obj.visible = false; }
  if (placed.jollyRoger && !sloop.docked && plan.day === dayNow() && !plan.done.jr) { placed.jollyRoger.visible = false; plan.done.jr = true; }
  for (const p of pirates) if (p.carrying) { const y = p.obj.rotation.y; p.carrying.position.set(p.pos.x + Math.sin(y) * 0.6, p.pos.y + 0.7, p.pos.z + Math.cos(y) * 0.6); p.carrying.rotation.y = y; }
  panic(); updateBees(); updateWagon(dt);
}

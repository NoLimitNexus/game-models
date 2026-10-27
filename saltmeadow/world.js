// The land, sea and sky, every building and plant, lamps, smoke, weather.
import * as THREE from 'three';
import { scene, camera, renderer, bloom, heightAt, groundY, shore, WATER_Y, FORT, LAKE, STREAM, PIERS, BRIDGE, fbm, smooth,
  rnd, rr, pick, V, place, plant, job, make, CLEAR, placed, BUILDINGS, glow, puff, distPolyline, T, inH } from './core.js';

// ------------------------------------------------------------------ roads (also used by the people)
export const NODES = {
  plaza: [0, 0], n1: [0, -24], chapel: [0, -42], fortRoad: [0, -96], fortGate: [0, -136], fortIn: [0, -160],
  w1: [-30, 0], w2: [-58, 4], forest: [-80, 8], deep: [-128, -8], camp: [-122, 26],
  e1: [30, 0], e2: [48, 2], farm: [62, 12], e3: [100, 4], bridge: [127, 6], e4: [170, 10], east: [330, 10],
  s1: [0, 24], harbor: [0, 42], pier: [0, 84], harborE: [34, 42], pier2: [34, 72], sw: [-24, 38], beachW: [-56, 36],
  ne: [22, -30], mill: [30, -44], lakeRoad: [70, -54], lake: [96, -60], nw: [-24, -28], tower: [-36, -40],
  pasture: [50, -12], paddock: [86, -2],
};
export const EDGES = [['plaza', 'n1'], ['n1', 'chapel'], ['chapel', 'fortRoad'], ['fortRoad', 'fortGate'], ['fortGate', 'fortIn'],
  ['plaza', 'w1'], ['w1', 'w2'], ['w2', 'forest'], ['forest', 'deep'], ['forest', 'camp'],
  ['plaza', 'e1'], ['e1', 'e2'], ['e2', 'farm'], ['farm', 'e3'], ['e3', 'bridge'], ['bridge', 'e4'], ['e4', 'east'],
  ['plaza', 's1'], ['s1', 'harbor'], ['harbor', 'pier'], ['harbor', 'harborE'], ['harborE', 'pier2'], ['harbor', 'sw'], ['sw', 'beachW'],
  ['n1', 'ne'], ['ne', 'mill'], ['mill', 'lakeRoad'], ['lakeRoad', 'lake'], ['n1', 'nw'], ['nw', 'tower'], ['e2', 'pasture'], ['farm', 'paddock']];
const ROAD_SEGS = EDGES.filter(([a, b]) => !b.startsWith('pier')).map(([a, b]) => [NODES[a], NODES[b]]);
const nearRoad = (x, z, r) => ROAD_SEGS.some(([a, b]) => distPolyline(x, z, [a, b]) < r);

// ------------------------------------------------------------------ terrain
const W = 900, D = 700, CZ = -100;
{
  const g = new THREE.PlaneGeometry(W, D, 260, 200).rotateX(-Math.PI / 2);
  const p = g.attributes.position, col = new Float32Array(p.count * 3), c = new THREE.Color();
  const grassA = new THREE.Color(0x6f9c48), grassB = new THREE.Color(0x58863a), forestC = new THREE.Color(0x40683a), sand = new THREE.Color(0xe4d09a),
    wet = new THREE.Color(0xc4ad78), rock = new THREE.Color(0x8b8a80), soil = new THREE.Color(0x7d5b3a), sea = new THREE.Color(0x6f9a8a), dryC = new THREE.Color(0x9aa85a);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i) + CZ, y = heightAt(x, z);
    p.setY(i, y);
    const n = fbm(x * 0.05, z * 0.05);
    c.copy(grassA).lerp(grassB, 0.5 + n * 0.5).lerp(dryC, Math.max(0, fbm(x * 0.012 + 3, z * 0.012) - 0.2) * 0.8);
    c.lerp(forestC, forestDensity(x, z) * 0.8);
    const sl = Math.abs(heightAt(x + 1, z) - y) + Math.abs(heightAt(x, z + 1) - y);
    c.lerp(rock, smooth(0.5, 1.1, sl));
    if (x > 45 && x < 93 && z > 20 && z < 41) c.lerp(soil, 0.85);
    const k = z - (shore(x) - 9);
    if (k > 0) c.lerp(sand, smooth(0, 2.5, k)).lerp(wet, smooth(5, 9, k));
    if (y < WATER_Y - 0.2) c.lerp(sea, 0.7);
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
  m.position.z = CZ; m.receiveShadow = true;
  scene.add(m);
}
export function forestDensity(x, z) {
  const west = smooth(-40, -75, x) * (1 - smooth(30, 48, z));
  const hills = smooth(2, 7, heightAt(x, z)) * 0.7;
  return Math.min(1, Math.max(0, (west + hills) * (0.55 + fbm(x * 0.02, z * 0.02) * 0.7)));
}

// ------------------------------------------------------------------ water
const seaGeo = new THREE.PlaneGeometry(1400, 760, 110, 60).rotateX(-Math.PI / 2);
const seaBase = Float32Array.from(seaGeo.attributes.position.array);
const seaAmp = new Float32Array(seaGeo.attributes.position.count);
{
  const p = seaGeo.attributes.position, col = new Float32Array(p.count * 3), c = new THREE.Color();
  const shallow = new THREE.Color(0x4fb8b6), deep = new THREE.Color(0x1b5a8c);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i) + 330, depth = WATER_Y - heightAt(x, z);
    c.copy(shallow).lerp(deep, smooth(0.3, 5, depth));
    col.set([c.r, c.g, c.b], i * 3);
    seaAmp[i] = smooth(0, 4, depth);
  }
  seaGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}
export const sea = new THREE.Mesh(seaGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05, flatShading: true, transparent: true, opacity: 0.9 }));
sea.position.set(0, WATER_Y, 330);
scene.add(sea);
const ocean = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1b5a8c, roughness: 0.6 }));
ocean.position.set(0, WATER_Y - 0.25, 0); scene.add(ocean);
export const waveAt = (x, z, t) => Math.sin(x * 0.09 + t * 1.1) * 0.28 + Math.sin(z * 0.13 - t * 0.8) * 0.22 + Math.sin((x + z) * 0.05 + t * 0.5) * 0.3;
const foam = (() => {
  const pts = []; for (let x = -460; x <= 460; x += 6) pts.push(x);
  const g = new THREE.BufferGeometry(), pos = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], za = shore(a) - 0.6, zb = shore(b) - 0.6;
    pos.push(a, 0, za - 1.4, b, 0, zb - 1.4, a, 0, za + 1.6, b, 0, zb - 1.4, b, 0, zb + 1.6, a, 0, za + 1.6);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, depthWrite: false }));
  m.position.y = WATER_Y + 0.12; scene.add(m); return m;
})();
const lakeWater = new THREE.Mesh(new THREE.CircleGeometry(LAKE.r + 2, 48).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0x3f8fa6, roughness: 0.3, metalness: 0.1, transparent: true, opacity: 0.88 }));
lakeWater.position.set(LAKE.x, -0.45, LAKE.z); scene.add(lakeWater);
{
  const g = new THREE.BufferGeometry(), pos = [];
  for (let i = 0; i < STREAM.length - 1; i++) {
    const [ax, az] = STREAM[i], [bx, bz] = STREAM[i + 1], n = Math.ceil(Math.hypot(bx - ax, bz - az) / 3);
    for (let j = 0; j < n; j++) {
      const t0 = j / n, t1 = (j + 1) / n, x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0, x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
      const nx = -(bz - az), nz = bx - ax, l = Math.hypot(nx, nz) / 2.8;
      pos.push(x0 - nx / l, 0, z0 - nz / l, x1 - nx / l, 0, z1 - nz / l, x0 + nx / l, 0, z0 + nz / l,
        x1 - nx / l, 0, z1 - nz / l, x1 + nx / l, 0, z1 + nz / l, x0 + nx / l, 0, z0 + nz / l);
    }
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x4a9ab0, roughness: 0.3, transparent: true, opacity: 0.85 }));
  m.position.y = -0.4; scene.add(m);
}

// ------------------------------------------------------------------ roads, plaza, piers
{
  const mat = new THREE.MeshLambertMaterial({ color: 0xa88d5c });
  const pos = [];
  for (const [[ax, az], [bx, bz]] of ROAD_SEGS) {
    const len = Math.hypot(bx - ax, bz - az), n = Math.ceil(len / 2), nx = -(bz - az) / len * 1.8, nz = (bx - ax) / len * 1.8;
    for (let j = 0; j < n; j++) {
      const t0 = j / n, t1 = (j + 1) / n, x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0, x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
      const y = (x, z) => groundY(x, z) + 0.06;
      pos.push(x0 - nx, y(x0 - nx, z0 - nz), z0 - nz, x1 - nx, y(x1 - nx, z1 - nz), z1 - nz, x0 + nx, y(x0 + nx, z0 + nz), z0 + nz,
        x1 - nx, y(x1 - nx, z1 - nz), z1 - nz, x1 + nx, y(x1 + nx, z1 + nz), z1 + nz, x0 + nx, y(x0 + nx, z0 + nz), z0 + nz);
    }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
  const roads = new THREE.Mesh(g, mat); roads.receiveShadow = true; scene.add(roads);
  const plazaM = new THREE.Mesh(new THREE.CircleGeometry(16, 48).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xb9ad93 }));
  plazaM.position.y = 0.07; plazaM.receiveShadow = true; scene.add(plazaM);
  const ring = new THREE.Mesh(new THREE.RingGeometry(15.4, 16.2, 48).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x8f846e }));
  ring.position.y = 0.08; scene.add(ring);
  const fortYard = new THREE.Mesh(new THREE.CircleGeometry(24, 40).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xa79a7c }));
  fortYard.position.set(FORT.x, FORT.h + 0.06, FORT.z); fortYard.receiveShadow = true; scene.add(fortYard);
  const wood = new THREE.MeshLambertMaterial({ color: 0x8a6440 });
  for (const p of PIERS) {
    const len = p.z1 - p.z0;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.3, len), wood);
    deck.position.set(p.x, 0.4, (p.z0 + p.z1) / 2); deck.castShadow = deck.receiveShadow = true; scene.add(deck);
    for (let z = p.z0 + 2; z <= p.z1; z += 4) for (const dx of [-3, 3]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 4), wood);
      post.position.set(p.x + dx, -1.4, z); post.castShadow = true; scene.add(post);
    }
  }
}

// ------------------------------------------------------------------ sky
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 1, 0) },
    sunCol: { value: new THREE.Color() }, moonDir: { value: new THREE.Vector3(0, 1, 0) }, moonAmt: { value: 0 }, flash: { value: 0 } },
  vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform vec3 top, horizon, sunDir, sunCol, moonDir; uniform float moonAmt, flash; varying vec3 vDir;
    void main(){ vec3 d = normalize(vDir); float h = max(d.y, 0.0);
      vec3 c = mix(horizon, top, pow(h, 0.55));
      if (d.y < 0.0) c = horizon * 0.92;
      float s = max(dot(d, sunDir), 0.0);
      c += sunCol * (pow(s, 900.0) * 6.0 + pow(s, 12.0) * 0.4 + pow(s, 4.0) * 0.06);
      float m = max(dot(d, moonDir), 0.0);
      c += vec3(0.85, 0.9, 1.0) * moonAmt * (smoothstep(0.9993, 0.9996, m) * 1.4 + pow(m, 60.0) * 0.12);
      c += vec3(0.75, 0.8, 1.0) * flash;
      gl_FragColor = vec4(c, 1.0); }`,
});
const skyDome = new THREE.Mesh(new THREE.SphereGeometry(2000, 32, 16), skyMat);
scene.add(skyDome);
const stars = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(
  Array.from({ length: 2200 }, () => { const th = rnd() * 6.283, y = rr(0.05, 1); const r = Math.sqrt(1 - y * y) * 1800;
    return [Math.cos(th) * r, y * 1800, Math.sin(th) * r]; }).flat(), 3)),
  new THREE.PointsMaterial({ color: 0xffffff, size: 1.8, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
scene.add(stars);
export const hemi = new THREE.HemisphereLight(0xdfefff, 0x4a5a32, 1.2); scene.add(hemi);
export const sun = new THREE.DirectionalLight(0xfff2dc, 2.4);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 1, far: 500 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.4;
scene.add(sun, sun.target);
const moon = new THREE.DirectionalLight(0x8fa8ff, 0); scene.add(moon, moon.target);
const clouds = [];
{
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, transparent: true, opacity: 0.94, fog: true });
  for (let i = 0; i < 26; i++) {
    const g = new THREE.Group();
    for (let j = 0; j < 7; j++) { const s = new THREE.Mesh(new THREE.IcosahedronGeometry(rr(6, 13), 1), mat); s.position.set(rr(-18, 18), rr(-2, 4), rr(-8, 8)); s.scale.y = 0.7; g.add(s); }
    g.position.set(rr(-600, 600), rr(110, 160), rr(-500, 400)); g.userData.v = rr(1.5, 3.5);
    clouds.push(g); scene.add(g);
  }
  clouds.mat = mat;
}
// rainbow after the rain: a half ring of colour far behind the town
const rainbow = new THREE.Mesh(new THREE.RingGeometry(230, 262, 96, 1, 0, Math.PI), new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, fog: false, uniforms: { a: { value: 0 } },
  vertexShader: 'varying vec2 vUv; varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform float a; varying vec3 vP; vec3 hue(float h){ return clamp(abs(mod(h*6.0+vec3(0,4,2),6.0)-3.0)-1.0,0.0,1.0); }
    void main(){ float r = (length(vP.xy) - 230.0) / 32.0; float edge = smoothstep(0.0,0.15,r) * smoothstep(1.0,0.85,r);
      gl_FragColor = vec4(hue(0.8 - r * 0.8), a * 0.45 * edge); }`,
}));
rainbow.position.set(0, -20, -420); scene.add(rainbow);

// ------------------------------------------------------------------ rain, lightning, fireflies
const RAIN_N = 3000;
const rainGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(RAIN_N * 6), 3));
const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xaac4e0, transparent: true, opacity: 0 }));
rain.frustumCulled = false; scene.add(rain);
const drops = Array.from({ length: RAIN_N }, () => [rr(-80, 80), rr(0, 45), rr(-80, 80)]);
const flies = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(160 * 3), 3)),
  new THREE.PointsMaterial({ color: 0xd8ff7a, size: 0.4, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
const flySeeds = Array.from({ length: 160 }, (_, i) => i < 110 ? [rr(-130, -50), rr(-40, 40), rr(0.5, 3), rr(0, 6.28)] : [LAKE.x + rr(-34, 34), LAKE.z + rr(-34, 34), rr(0.5, 2.5), rr(0, 6.28)]);
flies.frustumCulled = false; scene.add(flies);
export const weather = { rain: 0, rainUntil: -1, flash: 0, rainbow: 0, rainbowUntil: -1, mist: 0 };
export function startRain(h) { weather.rainUntil = h + 1.4; }

// ------------------------------------------------------------------ the town: houses, landmarks, props
export const HOMES = {};
function house(id, name, x, z, faceTo = [0, 0], s = 1) { HOMES[name] = { x, z }; place(id, x, z, { name, faceTo, clear: 9 * s, house: true, s }); }
house('village-tavern-4e94e3', 'tavern', 21, -18);
house('two-story-house-40f6dc', 'merchantHouse', -22, -16);
house('thatched-cottage-0e63f5', 'cottageA', -23, 15);
house('thatched-cottage-0e63f5', 'cottageB', 23, 17);
house('thatched-cottage-0e63f5', 'bakery', -42, -11, [-42, 0]);
house('two-story-house-40f6dc', 'houseW', -46, 14, [-46, 4]);
house('thatched-cottage-0e63f5', 'houseS1', -15, 31, [0, 31]);
house('two-story-house-40f6dc', 'houseS2', 15, 31, [0, 31]);
house('two-story-house-40f6dc', 'houseE', 40, -12, [40, 0]);
house('thatched-cottage-0e63f5', 'houseN', 14, -40, [12, -28]);
house('two-story-house-40f6dc', 'houseNW', -14, -38, [-12, -26]);
house('gabled-farmhouse-c7534f', 'farmhouse', 66, 6, [48, 2]);
house('log-cabin-4fac3b', 'cabin', -88, 18, [-80, 8]);
house('fisherman-shack-ea9b2b', 'shack', -28, 30, [-24, 38]);
house('fisherman-shack-ea9b2b', 'shack2', 52, 36, [34, 42]);
house('two-story-house-40f6dc', 'fortHall', FORT.x, FORT.z - 14, [FORT.x, FORT.z + 20], 1.25);
place('watchtower-140f78', -38, -50, { name: 'guardTower', faceTo: [-36, -40], clear: 6 }); HOMES.guardTower = { x: -38, z: -50 };
place('stone-chapel-03e774', 0, -58, { name: 'chapel', faceTo: [0, -42], clear: 10 });
place('windmill-3aad49', 33, -60, { name: 'windmill', faceTo: [30, -44], clear: 8 });
place('water-mill-b31972', 104, -50, { name: 'watermill', ry: Math.PI * 0.3, clear: 7 });
place('stilted-granary-3e7d7d', -36, 20, { faceTo: [-30, 0], clear: 5 });
place('clay-bread-oven-860b06', -36, -6, { faceTo: [-30, 0], name: 'oven' });
place('village-well-f8e361', 0, 0);
for (let i = 0; i < 4; i++) { const a = Math.PI * (0.78 + i * 0.16), x = Math.cos(a) * 11.5, z = Math.sin(a) * 11.5;
  place('market-stall-94937d', x, z, { faceTo: [0, 0], name: 'stall' + i }); }
place('signpost-8287c3', 5, -6, { ry: 0.7 });
place('water-trough-318ee1', 11, -28, { ry: 0.2 });
place('four-wheel-wagon-adb946', -14, -27, { ry: 2.4 });
place('wooden-cart-bf83d8', -12, 20, { ry: 0.8 });
place('campfire-4390aa', 9, 8, { name: 'campfire' });
for (const [x, z] of [[13, -9], [17, -6], [10, -12]]) place('campsite-picnic-table-361d51', x, z, { ry: 0.5 });
for (const [x, z] of [[-30, -22], [26, 28], [-8, -44], [44, -30]]) place('orchard-apple-tree-b21f85', x, z, { ry: rr(0, 6) });
// harbour
place('dock-warehouse-bf0967', 20, 40, { faceTo: [0, 42], clear: 9, name: 'warehouse' });
place('lookout-watchtower-f1a5ce', 62, 40, { faceTo: [34, 42], clear: 5 });
place('shipwright-boat-shed-9cbbc1', -46, 36, { faceTo: [-24, 38], clear: 8 });
place('dock-cargo-crane-ccd97f', 40, 47, { ry: Math.PI, clear: 4 });
for (const [x, z] of [[12, 44], [13.3, 45.2], [11.5, 45.6], [28, 44], [29.4, 44.4]]) place('barrel-8d63c4', x, z, { ry: rr(0, 6) });
for (const [x, z] of [[27, 46], [26, 44.6], [38, 44], [38.5, 45.5]]) place('cargo-crate-9afc44', x, z, { ry: rr(0, 6) });
place('drying-net-rack-93ec3b', -12, 43, { ry: 0.2 });
place('ship-anchor-c2b4f1', -6, 40, { ry: 0.4 });
place('jolly-roger-pole-803c5a', 6, 92, { name: 'jollyRoger', y: 0.55 });
// farm
place('red-barn-d41683', 74, -6, { faceTo: [62, 12], clear: 10 });
place('grain-silo-58ca67', 98, 8, { clear: 5 });
place('chicken-coop-371f97', 46, 18, { name: 'coop', faceTo: [48, 2], clear: 4 });
place('scarecrow-334079', 66, 32, { ry: 3.2 });
place('tool-shed-f61f49', 84, 24, { faceTo: [62, 12], clear: 5 });
place('greenhouse-53ab6d', 86, 12, { faceTo: [62, 12], clear: 6 });
place('windpump-tower-1633a9', 104, -14, { clear: 4 });
for (const [x, z, r] of [[72, -2, 0.3], [70, -1, 1.2], [80, 14, 2]]) place('hay-bale-079e8c', x, z, { ry: r });
for (const [x, z] of [[40, 30], [41.6, 31.5], [43.2, 30]]) place('beehive-2e70bf', x, z, { ry: 0.3 });
const CROPS = ['wheat-crop-7e08e6', 'turnip-crop-a5b3b7', 'pumpkin-crop-7de137', 'corn-crop-b71f2f', 'strawberry-crop-6bec33', 'wheat-crop-7e08e6'];
export const FIELD = [];
CROPS.forEach((id, r) => {
  const t = [];
  for (let c = 0; c < 18; c++) { const x = 48 + c * 2.5, z = 23 + r * 3.1; t.push([x, z, rnd() * 6, rr(0.9, 1.1)]); if (c % 4 === 1) FIELD.push([x, z - 1.3]); }
  plant(id, t);
});
plant('apple-tree-ef0ba0', [...Array(24)].map((_, i) => [76 + (i % 6) * 5, -50 + Math.floor(i / 6) * 5, rr(0, 6), rr(0.9, 1.1)]));
function fenceLine(id, a, b) {
  job(async () => {
    const proto = await make(id), size = new THREE.Box3().setFromObject(proto).getSize(new THREE.Vector3());
    const L = Math.max(size.x, 0.5), len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(len / L));
    const yaw = Math.atan2(b[0] - a[0], b[1] - a[1]) - Math.PI / 2;
    for (let i = 0; i < n; i++) { const t = (i + 0.5) / n, o = proto.clone(), x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
      o.position.set(x, groundY(x, z), z); o.rotation.y = yaw; o.scale.x = len / n / L; scene.add(o); }
  });
}
for (const [a, b] of [[[42, -34], [76, -34]], [[76, -34], [76, -14]], [[42, -34], [42, -14]], [[42, -14], [47, -14]], [[53, -14], [76, -14]],
  [[82, -24], [106, -24]], [[106, -24], [106, -4]], [[82, -24], [82, -4]], [[82, -4], [84, -4]], [[89, -4], [106, -4]]]) fenceLine('wooden-fence-section-d72055', a, b);
// forest
place('chopping-block-073b5e', -66, 17, { name: 'chop', clear: 3 });
place('chopping-block-073b5e', -98, 2, { name: 'chop2', clear: 3 });
place('open-woodshed-050a0a', -77, 27, { faceTo: [-80, 8], clear: 5 });
place('firewood-stack-8a2899', -71, 23, { ry: 0.4 });
place('camp-tent-3c5c89', -128, 32, { faceTo: [-122, 26], clear: 6 });
place('stone-fire-pit-4136b0', -120, 30, { clear: 3, name: 'campPit' });
place('trail-signpost-bd29a7', -52, 0, { ry: 1.2 });
place('trail-map-kiosk-be8618', -60, 10, { faceTo: [-58, 4] });
for (const [x, z] of [[-170, -30], [-176, -24], [-165, -36]]) place('large-boulder-a29b99', x, z, { ry: rr(0, 6), clear: 6 });
CLEAR.push([-140, -70, 22], [-122, 28, 9], [-66, 17, 5], [-98, 2, 5]);
// lake
place('dock-platform-section-b36e7c', 94, -66, { faceTo: [LAKE.x, LAKE.z], y: -0.15 });
// fort on the hill: a ring of palisade with a gatehouse and towers
job(async () => {
  const proto = await make('wooden-palisade-d4f4db'), size = new THREE.Box3().setFromObject(proto).getSize(new THREE.Vector3());
  const L = Math.max(size.x, 0.5), R = 26, N = 22;
  for (let i = 0; i < N; i++) {
    const a0 = i / N * Math.PI * 2, a1 = (i + 1) / N * Math.PI * 2, am = (a0 + a1) / 2;
    if (Math.abs(((am - Math.PI / 2 + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.2) continue;     // gate gap facing town
    const ax = FORT.x + Math.cos(a0) * R, az = FORT.z + Math.sin(a0) * R, bx = FORT.x + Math.cos(a1) * R, bz = FORT.z + Math.sin(a1) * R;
    const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / L));
    for (let j = 0; j < n; j++) { const t = (j + 0.5) / n, o = proto.clone(), x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      o.position.set(x, groundY(x, z), z); o.rotation.y = Math.atan2(bx - ax, bz - az) - Math.PI / 2; o.scale.x = len / n / L; scene.add(o); }
  }
});
place('village-gatehouse-181a9e', FORT.x, FORT.z + 26, { faceTo: [0, -100], clear: 6 });
for (const a of [0.25, 0.75, 1.25, 1.75]) place('watchtower-140f78', FORT.x + Math.cos(a * Math.PI) * 22, FORT.z + Math.sin(a * Math.PI) * 22, { faceTo: [FORT.x, FORT.z], clear: 4 });
place('open-stable-dbf2d5', FORT.x - 13, FORT.z + 2, { faceTo: [FORT.x, FORT.z], clear: 5 });
place('timber-barn-90b3ce', FORT.x + 14, FORT.z + 2, { faceTo: [FORT.x, FORT.z], clear: 6 });
place('stone-fire-pit-4136b0', FORT.x, FORT.z + 4, { name: 'fortPit' });
CLEAR.push([FORT.x, FORT.z, 30]);
// a bridge where the east road crosses the stream
place('wooden-bridge-9d2308', BRIDGE.x, BRIDGE.z, { ry: Math.atan2(170 - 100, 10 - 4), y: -0.1, s: 1.2, clear: 6 });
// beach
for (const [x, z] of [[-70, 38], [-38, 39], [62, 44], [76, 45], [-80, 40], [90, 46], [-100, 42], [110, 47], [-60, 41]]) place('palm-tree-a307da', x, z, { ry: rr(0, 6), s: rr(0.9, 1.2) });
for (let i = 0; i < 10; i++) { const x = rr(-140, 140), z = shore(x) - rr(3, 7); if (Math.abs(x) > 8 && Math.abs(x - 34) > 8) place('driftwood-log-90340b', x, z, { ry: rr(0, 6) }); }

// ------------------------------------------------------------------ lamps
export const lamps = [];
function lamp(id, x, z, withLight) {
  job(async () => {
    const o = await make(id); o.position.set(x, groundY(x, z), z); scene.add(o);
    const top = new THREE.Box3().setFromObject(o).max.y - 0.35;
    const g = glow(2.4); g.position.set(x, top, z); scene.add(g);
    const l = withLight ? new THREE.PointLight(0xffb85a, 0, 24, 1.6) : null;
    if (l) { l.position.set(x, top, z); scene.add(l); }
    lamps.push({ g, l });
  });
}
for (const [x, z, li] of [[3.5, -13, 1], [-13, 3.5, 1], [13, -2.5, 0], [3.5, 15, 1], [-3.5, 34, 0], [3.5, -34, 0], [-42, 3, 0], [40, 3, 0], [16, 39, 0],
  [3, -80, 0], [3, -120, 0], [74, 14, 0], [-70, 5, 0], [96, 6, 0], [30, -36, 0]]) lamp('lantern-post-f47665', x, z, !!li);
for (const [x, z, li] of [[-2.9, 58, 0], [2.9, 72, 1], [-2.9, 88, 0], [36.9, 60, 0], [31.1, 80, 0]]) lamp('dock-lantern-post-5e58a4', x, z, !!li);

// ------------------------------------------------------------------ fires
export const fires = [];
function fire(x, z, size, light) {
  const y = groundY(x, z);
  const f = { x, z, on: false, flames: [], glow: glow(size * 5), light: light ? new THREE.PointLight(0xff8a3a, 0, 26 * size, 1.4) : null };
  f.glow.position.set(x, y + 1.1 * size, z); scene.add(f.glow);
  if (f.light) { f.light.position.set(x, y + 1.5, z); scene.add(f.light); }
  for (let i = 0; i < 7; i++) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(rr(0.18, 0.32) * size, 1, 5), new THREE.MeshBasicMaterial({ color: i % 2 ? 0xffb030 : 0xff6a20, transparent: true, opacity: 0.92 }));
    m.position.set(x + rr(-0.35, 0.35) * size, y, z + rr(-0.35, 0.35) * size); m.userData = { k: rr(0, 6.28), h: rr(0.7, 1.3) * size, y };
    f.flames.push(m); scene.add(m);
  }
  fires.push(f); return f;
}
export const bonfire = fire(9, 8, 1.2, true);
export const campfire = fire(-120, 30, 0.8, true);
export const fortFire = fire(FORT.x, FORT.z + 4, 0.9, false);

// ------------------------------------------------------------------ plants: trees, bushes, grass, flowers (instanced)
const blocked = (x, z, pad = 0) => CLEAR.some(([cx, cz, r]) => (x - cx) ** 2 + (z - cz) ** 2 < (r + pad) ** 2) || nearRoad(x, z, 3.5 + pad);
function sample(n, test, bounds = [-440, 440, -440, 40]) {
  const out = []; let tries = 0;
  while (out.length < n && tries++ < n * 40) {
    const x = rr(bounds[0], bounds[1]), z = rr(bounds[2], bounds[3]);
    if (test(x, z)) out.push([x, z, rr(0, 6.283), rr(0.8, 1.3)]);
  }
  return out;
}
export function plantAll() {
  const dry = (x, z) => heightAt(x, z) > 0.4 && z < shore(x) - 10;
  const treeOk = (x, z) => dry(x, z) && !blocked(x, z, 2) && Math.hypot(x, z) > 30 && !(x > 40 && x < 108 && z > -36 && z < 42) && rnd() < forestDensity(x, z) + 0.04;
  const trees = sample(900, treeOk);
  const groups = { 'tall-pine-tree-ab4108': [], 'young-pine-0d7695': [], 'broadleaf-oak-997c22': [], 'maple-tree-65fa12': [], 'birch-tree-181b33': [], 'dead-tree-6795fa': [] };
  for (const t of trees) {
    const hilly = heightAt(t[0], t[1]) > 5;
    const k = rnd() < 0.015 ? 'dead-tree-6795fa' : hilly || rnd() < 0.45 ? (rnd() < 0.7 ? 'tall-pine-tree-ab4108' : 'young-pine-0d7695') : pick(['broadleaf-oak-997c22', 'maple-tree-65fa12', 'birch-tree-181b33']);
    groups[k].push(t);
  }
  for (const [id, t] of Object.entries(groups)) plant(id, t);
  const under = (x, z) => dry(x, z) && !blocked(x, z) && rnd() < forestDensity(x, z) + 0.15;
  plant('round-bush-cd2ac0', sample(260, under));
  plant('fern-plant-1559b8', sample(260, (x, z) => under(x, z) && forestDensity(x, z) > 0.3), { shadow: false });
  plant('toadstool-257a4a', sample(90, (x, z) => under(x, z) && forestDensity(x, z) > 0.4), { shadow: false });
  plant('fallen-log-1685fb', sample(40, (x, z) => under(x, z) && forestDensity(x, z) > 0.4));
  plant('medium-rock-e08405', sample(120, (x, z) => dry(x, z) && !blocked(x, z)));
  plant('large-boulder-a29b99', sample(30, (x, z) => dry(x, z) && !blocked(x, z, 4) && heightAt(x, z) > 4));
  const meadow = (x, z) => dry(x, z) && !blocked(x, z) && forestDensity(x, z) < 0.4 && Math.hypot(x, z) > 17 && !(x > 45 && x < 93 && z > 20 && z < 41);
  plant('grass-tuft-a40a08', sample(2200, meadow, [-220, 220, -260, 45]), { shadow: false });
  plant('wildflower-68d3a1', sample(700, meadow, [-200, 200, -240, 40]), { shadow: false });
  plant('sunflower-80ce15', [...Array(14)].map((_, i) => [44 + i * 2.6, 20.5, rr(0, 6), rr(0.9, 1.1)]), { shadow: false });
  plant('beach-grass-tuft-0e699f', sample(260, (x, z) => { const k = z - (shore(x) - 9); return k > 0.5 && k < 5 && !nearRoad(x, z, 3) && Math.abs(x) > 5; }, [-300, 300, 20, 60]), { shadow: false });
  plant('cattail-reed-6abbb3', sample(140, (x, z) => { const d = Math.hypot(x - LAKE.x, z - LAKE.z); const s = distPolyline(x, z, STREAM);
    return (Math.abs(d - LAKE.r) < 3 || (s > 2.5 && s < 4.5)) && !blocked(x, z); }, [60, 160, -130, 50]), { shadow: false });
  plant('lily-pad-86edbb', [...Array(30)].map(() => { const a = rr(0, 6.28), r = rr(8, LAKE.r - 3); return [LAKE.x + Math.cos(a) * r, LAKE.z + Math.sin(a) * r, rr(0, 6), rr(0.8, 1.4), -0.42]; }), { shadow: false });
}

// ------------------------------------------------------------------ after loading: door lights, chimneys, mill parts
const doorGlows = [], chimneys = [];
let sails, wheel;
export function finishWorld() {
  for (const o of BUILDINGS) {
    const box = new THREE.Box3().setFromObject(o), size = box.getSize(new THREE.Vector3()), r = Math.min(size.x, size.z) / 2;
    const yaw = o.rotation.y, fx = Math.sin(yaw), fz = Math.cos(yaw);
    const g = glow(2.6, 0xffc070); g.position.set(o.position.x + fx * (r + 0.3), o.position.y + 2.2, o.position.z + fz * (r + 0.3)); scene.add(g); doorGlows.push(g);
    chimneys.push(V(o.position.x - fx * r * 0.4 + fz * r * 0.3, o.position.z - fz * r * 0.4 - fx * r * 0.3, box.max.y - 0.4));
  }
  sails = placed.windmill?.getObjectByName('sails');
  wheel = placed.watermill?.getObjectByName('wheel');
}

// ------------------------------------------------------------------ day and night
const KEYS = [  // hour, sky top, horizon, sun colour
  [0, 0x050a18, 0x101a33, 0x000000], [4.6, 0x0a1430, 0x1d2a4f, 0x000000], [5.5, 0x41538a, 0xf2a070, 0xff9050],
  [6.6, 0x4f8fd0, 0xbfdcf0, 0xffe0b0], [12, 0x3f86d6, 0xc8e2f4, 0xfff4e0], [17.6, 0x4a8cd2, 0xcfe0ee, 0xffe8c0],
  [19.1, 0x5a6aa8, 0xf6a46a, 0xff8040], [20.1, 0x2a2c60, 0xa65a6a, 0xff5030], [21, 0x070c1e, 0x141c38, 0x000000], [24, 0x050a18, 0x101a33, 0x000000]];
const cA = new THREE.Color(), cB = new THREE.Color(), grey = new THREE.Color(0x6d757e);
function key(h, idx, out) {
  for (let i = 0; i < KEYS.length - 1; i++) if (h >= KEYS[i][0] && h <= KEYS[i + 1][0]) {
    const t = (h - KEYS[i][0]) / (KEYS[i + 1][0] - KEYS[i][0]); return out.copy(cA.set(KEYS[i][idx])).lerp(cB.set(KEYS[i + 1][idx]), t); }
  return out.set(KEYS[0][idx]);
}
export const light = { day: 1, lampsOn: 0 };
export function updateWorld(dt, rdt, h, focus, party) {
  const a = (h - 5.3) / 14.9 * Math.PI, sy = Math.sin(a), day = smooth(-0.12, 0.25, sy);
  light.day = day;
  // weather
  const raining = h < weather.rainUntil && h > weather.rainUntil - 1.5;
  weather.rain = THREE.MathUtils.clamp(weather.rain + (raining ? 0.4 : -0.25) * rdt, 0, 1);
  if (weather.rain > 0.5 && rnd() < rdt * 0.25) weather.flash = 1;
  weather.flash = Math.max(0, weather.flash - rdt * 3.2);
  const fl = weather.flash > 0.6 ? 1 : weather.flash > 0.3 ? 0 : weather.flash;
  if (!raining && weather.rainbowUntil > h && day > 0.6) weather.rainbow = Math.min(1, weather.rainbow + rdt * 0.2); else weather.rainbow = Math.max(0, weather.rainbow - rdt * 0.1);
  weather.mist = smooth(4.5, 6, h) * (1 - smooth(7, 9.5, h));
  const wet = weather.rain;
  // sky
  key(h, 1, skyMat.uniforms.top.value).lerp(grey, wet * 0.65 * day);
  key(h, 2, skyMat.uniforms.horizon.value).lerp(grey, wet * 0.55 * day);
  key(h, 3, skyMat.uniforms.sunCol.value).multiplyScalar(1 - wet);
  const sd = V(Math.cos(a) * 0.8, -0.5, Math.sin(a)).normalize(); sd.set(Math.cos(a), Math.max(sy, -0.3), -0.45).normalize();
  skyMat.uniforms.sunDir.value.copy(sd);
  skyMat.uniforms.moonDir.value.set(-Math.cos(a) * 0.7, Math.max(0.2, -sy), 0.5).normalize();
  skyMat.uniforms.moonAmt.value = (1 - day) * (1 - wet);
  skyMat.uniforms.flash.value = fl * 0.7;
  skyDome.position.copy(camera.position); stars.position.copy(camera.position);
  scene.fog.color.copy(skyMat.uniforms.horizon.value);
  scene.fog.near = 220 - wet * 140 - weather.mist * 150; scene.fog.far = 820 - wet * 380 - weather.mist * 330;
  sun.position.set(focus.x + sd.x * 200, Math.max(sd.y, 0.08) * 220, focus.z + sd.z * 200);
  sun.target.position.copy(focus);
  sun.intensity = day * 2.7 * (1 - wet * 0.65);
  sun.color.copy(skyMat.uniforms.sunCol.value).lerp(new THREE.Color(0xffffff), 0.35);
  moon.position.set(focus.x - 80, 140, focus.z + 50); moon.target.position.copy(focus);
  moon.intensity = (1 - day) * 0.6 + fl * 2.5;
  hemi.intensity = 0.28 + day * 0.95 + fl * 1.5;
  hemi.color.set(day > 0.5 ? 0xdfefff : 0x7084c4);
  stars.material.opacity = (1 - day) * 0.95 * (1 - wet);
  clouds.mat.color.setScalar(0.3 + day * 0.7).lerp(grey, wet * 0.5);
  for (const c of clouds) { c.position.x += c.userData.v * dt * 2; if (c.position.x > 650) c.position.x = -650; }
  renderer.toneMappingExposure = 0.95 + (1 - day) * 0.3;
  bloom.strength = 0.35 + (1 - day) * 0.55;
  // rainbow faces the camera from the far side of town
  rainbow.material.uniforms.a.value = weather.rainbow;
  rainbow.position.set(camera.position.x - Math.sin(camera.rotation.y) * 600, -40, camera.position.z - Math.cos(camera.rotation.y) * 600);
  rainbow.lookAt(camera.position.x, -40, camera.position.z);
  // lamps, doors, fires
  const lampsOn = THREE.MathUtils.clamp(1 - day * 1.4, 0, 1) + wet * day * 0.5;
  light.lampsOn = lampsOn;
  for (const l of lamps) { l.g.material.opacity = Math.min(1, lampsOn) * 0.95; if (l.l) l.l.intensity = Math.min(1, lampsOn) * 15; }
  for (const g of doorGlows) g.material.opacity = Math.min(1, lampsOn) * 0.8;
  bonfire.on = party; campfire.on = inH(h, 19.5, 2); fortFire.on = inH(h, 19, 5.5);
  for (const f of fires) {
    const flick = Math.sin(T.sim * 17 + f.x) * 0.15 + Math.sin(T.sim * 7.3 + f.z) * 0.1, on = f.on && wet < 0.6;
    if (f.light) f.light.intensity = on ? (22 + flick * 30) * (0.35 + Math.min(1, lampsOn) * 0.65) : 0;
    f.glow.material.opacity = on ? 0.85 + flick : 0;
    for (const m of f.flames) { m.visible = on; const u = m.userData, hh = u.h * (0.75 + 0.25 * Math.sin(T.sim * 9 + u.k) + 0.1 * Math.sin(T.sim * 23 + u.k));
      m.scale.set(1, hh, 1); m.position.y = u.y + 0.25 + hh / 2; m.rotation.y = T.sim * 2 + u.k; }
    if (on && rnd() < dt * 3) puff(V(f.x, f.z, groundY(f.x, f.z) + 2), { size: 1, color: 0x666666, opacity: 0.35, life: 5, rise: 1.6 });
  }
  // chimneys smoke in the morning and evening
  if (inH(h, 5.5, 9.5) || inH(h, 17, 23)) for (const c of chimneys) if (rnd() < dt * 0.9) puff(c, { size: 1.1, color: 0xcfcfcf, opacity: 0.45, life: 7, rise: 1.3 });
  if (sails) sails.rotation.z += dt * (0.6 + wet);
  if (wheel) wheel.rotation.x -= dt * 0.7;
  // sea
  const p = seaGeo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, waveAt(seaBase[i * 3], seaBase[i * 3 + 2] + 330, T.sim) * seaAmp[i]);
  p.needsUpdate = true; seaGeo.computeVertexNormals();
  foam.material.opacity = 0.25 + Math.sin(T.sim * 0.9) * 0.15;
  // rain and fireflies
  rain.material.opacity = wet * 0.5;
  if (wet > 0.01) { const rp = rainGeo.attributes.position, cx = focus.x, cz = focus.z;
    drops.forEach((d, i) => { d[1] -= dt * 40; if (d[1] < 0) { d[1] += 45; d[0] = rr(-80, 80); d[2] = rr(-80, 80); }
      rp.setXYZ(i * 2, cx + d[0], d[1], cz + d[2]); rp.setXYZ(i * 2 + 1, cx + d[0] + 0.15, d[1] + 1.2, cz + d[2]); }); rp.needsUpdate = true; }
  flies.material.opacity = (1 - day) * 0.95 * (1 - wet);
  if (day < 0.9) { const fp = flies.geometry.attributes.position;
    flySeeds.forEach((s, i) => fp.setXYZ(i, s[0] + Math.sin(T.sim * 0.3 + s[3]) * 2, groundY(s[0], s[1]) + s[2] + Math.sin(T.sim * 0.9 + s[3]) * 0.5, s[1] + Math.cos(T.sim * 0.25 + s[3]) * 2));
    fp.needsUpdate = true; }
}

// Usage: node inspect-gltf.mjs <file.gltf|file.glb> ...   (reads only; prints a summary of each file)
import fs from 'node:fs';
import path from 'node:path';

function load(file) {
  const buf = fs.readFileSync(file);
  if (file.toLowerCase().endsWith('.glb')) {
    const jsonLen = buf.readUInt32LE(12);
    return JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
  }
  return JSON.parse(buf.toString('utf8'));
}

for (const file of process.argv.slice(2)) {
  const g = load(file);
  const acc = g.accessors || [];
  let tris = 0;
  const meshes = (g.meshes || []).map((m) => {
    let t = 0;
    for (const p of m.primitives) {
      t += p.indices !== undefined ? acc[p.indices].count / 3 : acc[p.attributes.POSITION].count / 3;
    }
    tris += t;
    return `${m.name}(${Math.round(t)})`;
  });
  const skins = (g.skins || []).map((s) => ({ n: s.joints.length, names: s.joints.map((j) => g.nodes[j].name) }));
  console.log('==', path.basename(file));
  console.log('  tris', Math.round(tris), '| meshes', meshes.slice(0, 6).join(', '), meshes.length > 6 ? `+${meshes.length - 6}` : '');
  console.log('  images', (g.images || []).length, '| materials', (g.materials || []).length, '| ext', (g.extensionsUsed || []).join(','));
  for (const s of skins.slice(0, 2)) {
    console.log('  skin joints', s.n, ':', s.names.slice(0, 14).join(' '), s.n > 14 ? '...' : '');
  }
  const anims = g.animations || [];
  console.log('  animations', anims.length);
  if (anims.length) console.log('   ', anims.map((a) => a.name).join(' | '));
}

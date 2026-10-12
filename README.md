# Game models

Free, animated 3D characters for the games (Lakeside, Wayfarer, the Unity pilot), converted to GLB and
shrunk for phones. All of it is CC0 (public domain). To look at everything, open https://nolimitnexus.github.io/game-models/
or double-click `Open Model Lab.cmd` (it starts a small local server; the page cannot run from a plain file):
pick a pack, a character, hair and an animation, or press **Lineup** to see a whole pack side by side.

## The two options

| | Quaternius | KayKit |
|---|---|---|
| Look | Realistic-stylized, readable up close | Chunky low-poly, reads well from the high game view |
| Characters | Superhero M/F, Peasant M/F, Ranger M/F, 6 hairstyles, 6 hair colors | Knight, Barbarian, Mage, Ranger, Rogue, Rogue Hooded |
| Size | about 14,000 triangles, 65 bones (fingers), 1024 px PBR textures, 2 to 8 MB each | about 6,000 triangles, 23 bones, one palette texture, under 0.5 MB each |
| Animations | 45 (walk, run, sword, spell, sit, swim, dance...) | 132 (movement, melee, ranged, sitting, plus a full fishing set, chopping, digging, pickaxe, hammering, sawing) |

## The one rule that makes this work

**One rig per pack.** Every animation of a pack plays on every character of that pack, because clips find
their bones by name. No retargeting. Mixing packs is the thing to avoid.

- Quaternius rig: `root, pelvis, spine_01..03, neck_01, Head, clavicle_l, upperarm_l, ...` (65 bones, Unreal naming)
- KayKit rig: `root, hips, spine, chest, upperarm.l, lowerarm.l, wrist.l, hand.l, handslot.l, head, ...` (23 bones)

Hair and heads are separate skinned meshes on the same rig, so they attach to any body in the pack
(see `attachParts` in `viewer.js`). The free outfit pieces come without a head; `library/quaternius/heads`
holds the head cut from the Superhero bodies, which is what the outfit pack's own readme says to use.

## Layout

```
library/quaternius/{characters,outfits,heads,hair,animations}/*.glb
library/kaykit/{characters,animations}/*.glb
library/ours/characters/*.glb   our own characters on the KayKit skeleton
characters/*.json      the specs those are built from
licenses/            the license text shipped with each pack
index.html, viewer.js   the viewer (Three.js 0.170, no build step)
tools/               fetch-packs.ps1, build-library.ps1, bl_convert.py, bl_make_character.py (Blender, headless), serve.mjs, inspect-gltf.mjs
```

`downloads/` and `extracted/` (the original packs, about 1 GB) are not in git; `tools\fetch-packs.ps1`
brings them back and `tools\build-library.ps1` rebuilds `library/` from them (Blender 5.x from the Store).

## Using a character in Three.js

```js
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const loader = new GLTFLoader();
const body = await loader.loadAsync('library/kaykit/characters/Knight.glb');
const anims = await loader.loadAsync('library/kaykit/animations/Rig_Medium_MovementBasic.glb');

const knight = SkeletonUtils.clone(body.scene);          // clone() per islander, they share geometry
const mixer = new THREE.AnimationMixer(knight);
mixer.clipAction(THREE.AnimationClip.findByName(anims.animations, 'Walking_A')).play();
// each frame: mixer.update(dt)
```

Clips from a finger-bone-rich rig may name bones a character lacks; `clipFor` in `viewer.js` drops those
tracks so the console stays quiet.

## Our own characters (built on the KayKit skeleton)

KayKit is the one we are building on. `characters/*.json` + `tools/bl_make_character.py` make our own
characters that use KayKit's exact skeleton, so **all 132 KayKit animations play on them unchanged**.
Five exist: Islander (Lakeside's colors), Farmer, Angler, Cook, Smith (4,000 to 5,400 triangles,
130 to 170 KB each, no textures, 10 materials).

A spec is a few lines:

```json
{ "name": "Farmer", "hair": "short", "sleeves": "long", "trousers": "long",
  "colors": { "skin": "#e2b48a", "shirt": "#6a9a4c", "trousers": "#6b5236", "hair": "#a06a2c" } }
```

- `hair`: `short`, `long`, `bun`, `bald`; `sleeves`: `long`, `short`; `trousers`: `long`, `shorts`
- `colors`: `skin shirt trousers boots belt linen hair eyes eyeshine mouth` (any you leave out use the defaults)
- To make another: copy a spec, change it, run `tools\build-library.ps1` (or call the generator directly, see the
  header of `bl_make_character.py`), then add its name to the `ours` list in `viewer.js`.
- To change the body itself (shapes, proportions, a new hairstyle), edit `build_character()` in `bl_make_character.py`.
  Positions are in Blender units on KayKit's skeleton (Z up, faces -Y, left = +X); the bone positions are listed by
  `tools\bl_inspect_rig.py`.

**Why every animation works:** the skeleton is copied from KayKit's Knight, and the skin weights are copied from
KayKit's own neutral Mannequin (nearest surface; head parts are rigid to the head bone), so joints bend the way
KayKit's do. Checked in the viewer's browser: for all 139 clips (132 distinct) at four moments each, every bone of every
character of ours is at the same world position as KayKit's Knight, and no clip track is left without a bone.

**Recolor in a game** (cosmetics): each part is its own named material. `SkeletonUtils.clone` shares materials between
clones, so clone the material before changing it:

```js
const body = SkeletonUtils.clone(gltf.scene);
body.traverse((o) => {
  if (o.isMesh && o.material.name === 'shirt') { o.material = o.material.clone(); o.material.color.set('#3f7ca8'); }
});
```

**Hats and tools** attach to bones: the head bone is named `head`, the hand slots `handslot.l` and `handslot.r`.
Three.js strips dots from names, so look them up as `head`, `handslotl`, `handslotr`
(`root.getObjectByName('handslotr').add(tool)`).
## Not wired in

`Kenney Animated Characters 3` (CC0, one rig, 3 animations) was downloaded but not converted: too few
animations to be an option next to these two.

## Credits (optional under CC0)

Quaternius (quaternius.com), Kay Lousberg (kaylousberg.com).

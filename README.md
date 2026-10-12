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
licenses/            the license text shipped with each pack
index.html, viewer.js   the viewer (Three.js 0.170, no build step)
tools/               fetch-packs.ps1, build-library.ps1, bl_convert.py (Blender, headless), inspect-gltf.mjs
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

## Not wired in

`Kenney Animated Characters 3` (CC0, one rig, 3 animations) was downloaded but not converted: too few
animations to be an option next to these two.

## Credits (optional under CC0)

Quaternius (quaternius.com), Kay Lousberg (kaylousberg.com).

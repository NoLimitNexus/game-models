# Game models

Our own animated characters for the games (Wayfarer first, then Lakeside and the rest). A character is a **body kit**: a
bare body plus swappable parts (hair, beard, hat, top, bottom, boots, backpack) and tools in the hand, all built on one
skeleton so every animation plays on every mix of parts.

- **Look at everything:** https://nolimitnexus.github.io/game-models/ (or double-click `Open Model Lab.cmd` for a local copy;
  the page cannot run from a plain file). Pick a character, swap parts, recolor, put a tool in the hand, play any animation.
- Everything in `library/ours` is ours: made by `tools/bl_make_kit.py`, no third-party meshes.
- The animation clips in `library/animations` are KayKit's (CC0, Kay Lousberg), kept as the shared set until we author our own.
  The skeleton is KayKit's `Rig_Medium` (that is what lets us use all 132 of them); `licenses/` has the license text.
- KayKit's classic characters (Knight, Barbarian, Mage, Ranger...) are the quality benchmark: on this PC only, in the
  git-ignored `reference/kaykit`, never published. The lab shows them under "Reference" when run locally.

## The kit

```
library/ours/body/Body.glb       the bare body: one skin mesh per region (head, torso, arms, hands, legs, feet) plus the face
library/ours/parts/<id>.glb      19 parts: hair (6), beard (2), top (3), bottom (2), boots (2), hat (3), backpack
library/ours/tools/<id>.glb      axe, pickaxe, hammer, net, rod (handle along +Y, origin at the grip)
library/ours/manifest.json       every file with its slot, the skin regions it hides, its materials and default colors
library/ours/presets.json        named looks (Islander, Farmer, Angler, Cook, Smith, Miner, The old man)
library/animations/*.glb         the clips (animation only); roles.json maps game words (walk, chop, fish...) to clips
```

A part is a skinned shell on the same 23-bone skeleton. Wearing one hides the skin regions it covers (`hides` in the
manifest), so nothing is drawn twice. Every part uses named materials (`skin shirt trousers boots belt linen hair hat
hatband pack eyes mouth`), so a game recolors a part by material name; that is the whole customization system.

`character.js` assembles a character from these files (no DOM in it; the lab, the game and the admin pages all use it):

```js
const lib = new Library(await catalogFromFiles('/'));
const c = await Character.create(lib, { parts: { hair: 'hair_long', top: 'top_tee' }, colors: { shirt: '#3f7ca8' }, tool: 'axe' });
scene.add(c.holder);  c.setHeight(1.5);  c.playRole('chop');   // each frame: c.update(dt)
```

Roles in use by the games: `idle walk run chop mine hammer saw dig fish fish_cast fish_reel fish_catch cook craft pickup
interact use cheer wave sit hit` (see `library/animations/roles.json`). Bones are named `head`, `handslotl`, `handslotr`
(Three.js strips dots), which is where hats and tools attach.

## Making and changing things

Everything is built by `tools/bl_make_kit.py` (headless Blender; no window opens). Shapes are a few numbers each:

- **A new part:** write a `p_<name>(kit)` function (see `p_hair_short`, `p_top_tee`), add it to `PARTS` with its slot and the
  skin regions it hides, run `tools\build-library.ps1`. It appears in the lab, and in the game once synced.
- **A new tool:** a `t_<name>(kit)` function in `TOOLS`. Author it with the handle along +Z in Blender (that is +Y in the
  game), the grip at the origin, the edge side toward -X.
- **Reshaping the body toward KayKit's polish:** the head is `HEAD_C` / `HEAD_R` and the two exponents in `build_body`; the
  torso is the `TORSO` profile (z, half width, half depth); limbs are tubes along the bones. The skeleton, the slots, the
  materials and the animations do not change, so everything already built keeps working. Faces are in `build_body` too.
- Skin weights are copied from KayKit's neutral Mannequin (`tools/reference/Mannequin_Medium.glb`) by nearest surface; head
  parts are rigid to the head bone. `tools/bl_make_rig.py` makes the skeleton file (`tools/reference/Rig_Medium.glb`).

```
tools\fetch-packs.ps1        downloads KayKit's animation pack and classic characters into downloads\ and extracted\ (not in git)
tools\build-library.ps1      rebuilds library\ from scratch and fills reference\
tools\sync-to-wayfarer.ps1   copies character.js and library\ into the game (the game keeps its own copy and falls back to it)
tools\serve.mjs              the tiny local server behind "Open Model Lab.cmd"
tools\bl_inspect_rig.py      prints a rig's bones and a mesh's skin weights; tools\inspect-gltf.mjs summarizes any glTF
```

## Checked

For the old square-headed kit, every bone of every character matched KayKit's own Knight in all 139 clips (132 distinct);
the new kit uses the same skeleton file and the same weight source, and the lab plays all of them on it.

## Credits

Animation clips and the skeleton: Kay Lousberg (kaylousberg.com), CC0.

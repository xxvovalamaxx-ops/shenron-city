# Capybara reconstruction provenance

## Purpose

This folder preserves the exact, reviewable source chain for Shenron City's
animated capybara. The final asset is a project reconstruction; it is not a
downloaded wildlife mesh.

## Source chain

1. The owner supplied low-resolution capybara photographs as anatomical
   targets. Those photographs are not redistributed in this repository.
2. OpenAI image generation produced the clean zoological profile
   `capybara_reconstruction_reference.png` and the consistent four-view
   `capybara_turnaround_reference_v2.png`. The supplied photographs were used
   only as anatomical targets.
3. The transparent left profile was normalized into
   `capybara_triposr_input.png`, the exact square input used by the accepted
   reconstruction.
4. The official TripoSR implementation at commit
   `107cefdc244c39106fa830359024f6a2f1c78871` reconstructed
   `capybara_triposr_source.obj` and `capybara_triposr_texture.png` with the
   public `stabilityai/TripoSR` checkpoint.
5. Blender Foundation MCP ran
   `SourceAssets/Blender/scripts/rig_capybara.py`. The script applies real-world
   scale and axes, closes extraction boundaries with a fine voxel pass,
   reduces the game topology, projects the four views, bakes portable PBR
   textures, creates a 43-bone rig and 21 actions, renders review poses, and
   exports both authoring and runtime GLBs.

TripoSR's official code and pretrained model are released under the MIT
license. No TripoSR source code or model weights are vendored in Shenron City.
Rejected experimental reconstruction outputs are not included in the
repository.

## Reconstruction plate prompt

```text
Use case: photorealistic-natural
Asset type: clean image-to-3D reconstruction reference plate for a realistic
game animal

Input images: uploaded capybara photos are anatomical reference targets only.

Primary request: Create one anatomically accurate adult capybara
(Hydrochoerus hydrochaeris), full body, standing naturally in a neutral
quadruped pose, exact strict left-facing side profile.

Scene/backdrop: seamless flat light gray studio background, no horizon line,
no props, no plants, no water, no ground texture.

Subject: real capybara anatomy: heavy but not cubic barrel torso, gently arched
rump, distinct shoulders, short sturdy lower legs, correct four front toes and
three rear toes, no visible tail, blunt rectangular muzzle, straight
forehead-to-rostrum transition, small rounded ears, small high-set dark eyes
and nostrils, coarse reddish-brown guard hair with darker lower legs.

Style/medium: high-resolution zoological wildlife photograph, natural
proportions and real fur, not a stylized render.

Composition/framing: entire animal visible from ears to every toe, centered,
generous padding, orthographic-like side view with minimal perspective
distortion, head level, all four legs readable and separated.

Lighting/mood: soft neutral diffuse studio light that reveals silhouette and
fur direction without dramatic highlights.

Constraints: anatomical realism first; match the uploaded references; clean
readable silhouette for image-to-3D; no cast shadow overlapping feet; no
collar; no accessories; no text; no watermark.

Avoid: cartoon, toy, plush, mascot, pig snout, bear paws, giant eyes, giant
ears, cubic torso, fused legs, sitting, walking motion blur, open mouth, extra
limbs, missing toes, background scenery.
```

## Rebuild notes

The reconstruction runtime is intentionally not vendored. Reproducing the raw
mesh requires the pinned TripoSR commit and checkpoint. Rebuilding from the
committed raw mesh requires Blender 5.1 and the repository script. The editable
`capybara_rigged.blend` and source OBJ are tracked with Git LFS; the runtime
GLB and three compact same-origin PBR textures remain normal Git content so a
fresh web checkout can build without an asset conversion step. After a Blender
re-export, run `node scripts/externalize-glb-images.mjs
public/models/animals/capybara/capybara.glb` before the asset verifier.

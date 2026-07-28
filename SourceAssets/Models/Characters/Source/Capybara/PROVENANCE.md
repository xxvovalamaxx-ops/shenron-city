# Capybara reconstruction provenance

## Purpose

This folder preserves the exact, reviewable source chain for Shenron City's
high-detail capybara. The final asset is a new reconstruction; it is not a
downloaded wildlife model.

## Source chain

1. The owner supplied two low-resolution capybara photographs as anatomical
   targets. Those photographs are not redistributed in this repository.
2. OpenAI image generation produced
   `capybara_reconstruction_reference.png`, a clean zoological side-profile
   plate. The supplied photographs were used as anatomical references.
3. U²-Net background removal created
   `capybara_reconstruction_input.png`, the square neutral-background input
   used for reconstruction.
4. The official TripoSR implementation at commit
   `107cefdc244c39106fa830359024f6a2f1c78871` reconstructed
   `capybara_reconstruction.obj` and
   `capybara_reconstruction_texture.png` with the public
   `stabilityai/TripoSR` checkpoint.
5. Blender Foundation MCP ran
   `SourceAssets/Blender/scripts/create_capybara.py`. The script sets verified
   adult scale, projects the high-detail reference onto the visible anatomy,
   blends the reconstruction texture onto non-side-facing surfaces, bakes
   `capybara_final_albedo.png`, and exports the reviewed GLB.

TripoSR's official repository states that its code and pretrained model are
released under the MIT license. No TripoSR source code or model weights are
vendored in Shenron City.

## Reconstruction plate prompt

```text
Use case: photorealistic-natural
Asset type: clean image-to-3D reconstruction reference plate for a realistic
game animal

Input images: both uploaded capybara photos are anatomical reference targets
only.

Primary request: Create one anatomically accurate adult capybara
(Hydrochoerus hydrochaeris), full body, standing naturally in a neutral
quadruped pose, exact strict left-facing side profile.

Scene/backdrop: seamless flat light gray studio background, no horizon line,
no props, no plants, no water, no ground texture.

Subject: real capybara anatomy: heavy but not cubic barrel torso, gently arched
rump, distinct shoulders, short sturdy but slender lower legs, correct four
front toes and three rear toes, no visible tail, blunt rectangular muzzle,
straight forehead-to-rostrum transition, small rounded ears, small high-set
dark eyes and nostrils, coarse reddish-brown guard hair with darker
wet-looking lower legs.

Style/medium: high-resolution zoological wildlife photograph, natural
proportions and real fur, not a 3D render.

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
mesh requires the pinned TripoSR commit and checkpoint; rebuilding the Blender
asset from the committed raw mesh requires only Blender 5.1 and the repository
script. The local `.blend` remains ignored because repository policy reserves
large editable authoring files for a future reviewed LFS workflow.

# Quaternius Universal Hero

- Character source:
  <https://quaternius.com/packs/modularcharacteroutfitsfantasy.html>
- Character Itch download:
  <https://quaternius.itch.io/modular-character-outfits-fantasy>
- Acquired: 2026-07-28
- Creator: Quaternius
- License: CC0 1.0; the included license text is preserved beside this record.
- Standard archive SHA-256:
  `c3468b18871cc8c8f05ab14df7712baf22cb9f389cbd870babf130e595187f70`
- `Male_Ranger.gltf` SHA-256:
  `e1033a212332d84d98c19bc4927c621635478d0aa15d13c79da68d3ba9e0196f`
- `Male_Ranger.bin` SHA-256:
  `5bbb0d42cb324c6c27ce00417e68a876d92978f07d161f83590f0d7c0570eff6`
- Runtime GLB SHA-256:
  `90d5de9a91bbad659fa5a771baa505a82702e39f5db536a60496216bf49562ae`

The free Standard package supplies complete male and female Ranger and Peasant
outfits. The runtime hero uses the clothed Male Ranger and the source package's
65-joint rig, which exactly matches both Universal Animation Library Standard
skeletons by joint count, name, and order.

`scripts/convert-quaternius-hero.py` repairs two incorrect duplicated-suffix
texture paths in the published glTF without changing the source archive,
resizes source textures to at most 1K, embeds them as JPEG, normalizes height to
1.82 m, adds 29 implemented CC0 motions, and exports one 4.29 MiB browser GLB.
The original archives remain in ignored `Raw/Verified/` authoring storage.

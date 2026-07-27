# Asset policy

The current prototype is procedural and ships without external art, audio, or
font downloads.

When source assets are introduced:

- keep runtime-ready, reasonably sized assets in an `assets/` folder close to
  the feature that owns them;
- use Git LFS for large source files such as `.blend`, `.psd`, and lossless
  audio masters;
- record the creator, license, source, and export settings beside third-party
  assets;
- do not load production assets from a CDN or a developer's machine;
- optimize exported meshes, textures, and audio before they enter the game.

Generated build output belongs in `dist/` and is not committed.

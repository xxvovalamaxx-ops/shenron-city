# Environment

Roads, terrain, skyline pieces, plazas, and larger set-dressing assemblies.
Split exports by streaming or instancing responsibility instead of producing
one city-sized mesh.

## Layered CC0 meadow

The Blender authoring scene uses a deliberately coherent temperate pine-floor
biome rather than mixing unrelated catalogue downloads. Its three layers are:

1. matching Pine Forest PBR ground plus a scanned mud path, fine/tall grass,
   nettle, weed, moss, fern, branch, rock, sapling, and pine variation;
2. deterministic clustered masks with path, rock, and tree exclusions;
3. shared subtle wind on vegetation.

Restore the exact reviewed source set through Poly Haven's public API. Models
and materials use their 1K Blender variants; environment lighting uses a 2K
pure-sky HDRI:

```powershell
python SourceAssets\Blender\scripts\fetch_cc0_meadow_assets.py
```

Build the portable authoring file and proof render:

```powershell
& "C:\Program Files\Blender Foundation\Blender 5.1\blender.exe" `
  --background --factory-startup `
  --python SourceAssets\Blender\scripts\create_aaa_meadow.py
```

Use `-- --skip-render` for a lower-load authoring rebuild. The ignored local
output is `Working/Shenron_AAA_Meadow.blend`; the tracked API receipt and proof
render make the source set reproducible and reviewable without committing an
approximately 1 GB raw library.

Build the 1K WebP runtime subset and the geometry-only LOD1 template pack:

```powershell
python SourceAssets\Blender\scripts\build_runtime_meadow_assets.py

& "C:\Program Files\Blender Foundation\Blender 5.1\blender.exe" `
  --background --factory-startup `
  --python SourceAssets\Blender\scripts\export_web_meadow_templates.py `
  -- --output-path public\models\environment\meadow-templates.glb
```

The output is deliberately small: eleven 1K maps plus four normalized plant
templates. Medium/high quality reuses the deterministic web scatter with real
LOD1 silhouettes; low quality keeps the zero-download procedural fallback.
`verify-runtime-meadow-assets.mjs` pins every output, validates WebP dimensions,
parses the GLB contract, and enforces triangle and total-byte budgets.

## Original CC0 Japanese forest shrine

The repository also contains a self-contained original shrine scene that can be
published, forked, and remixed under CC0 1.0 Universal:

```powershell
& "C:\Program Files\Blender Foundation\Blender 5.1\blender.exe" `
  --background --factory-startup `
  --python SourceAssets\Blender\scripts\create_japanese_forest_shrine.py
```

The generator uses no downloads. It creates the editable source at
`Working/Japanese_Forest_Shrine_Original_CC0.blend` and configures the proof
render at `docs/Assets/Previews/japanese-forest-shrine-original.png`. Provenance,
scope, checksums, and the CC0 dedication are tracked beside the source and
enforced by `scripts/verify-japanese-forest-shrine-source.mjs`.

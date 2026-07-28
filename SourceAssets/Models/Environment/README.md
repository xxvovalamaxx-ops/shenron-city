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

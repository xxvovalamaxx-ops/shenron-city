# Kenney Animated Characters

The runtime citizen is derived from two Kenney CC0 packs:

| Pack | Source | Download | ZIP SHA-256 |
|---|---|---|---|
| Animated Characters Retro | <https://kenney.nl/assets/animated-characters-retro> | <https://kenney.nl/media/pages/assets/animated-characters-retro/93305a3c49-1774772819/kenney_animated-characters-retro.zip> | `1d03f1fb001f3cf629425b69c898df58261a316616220ea25b58bd35298e6882` |
| Animated Characters Protagonists | <https://kenney.nl/assets/animated-characters-protagonists> | <https://kenney.nl/media/pages/assets/animated-characters-protagonists/608191acc4-1774773108/kenney_animated-characters-protagonists.zip> | `ec3787de70fa2200256848d74201b10f6b6c3126594e9857bf989753312c2b84` |

- Acquired: 2026-07-28
- Creator: Kenney
- License: CC0 1.0; both packs' preserved license files are beside this record.
- Shared `characterMedium.fbx` SHA-256:
  `18835fef534eede635b081ee7fe647d01a885550a591d2e6bf071010906167d8`
- Runtime GLB SHA-256:
  `fd4140f779612aa48235dcafe07de320b22cf2decb6ffd43642142fc888dfe70`

The source archives remain outside Git. `scripts/convert-kenney-character.py`
rebuilds the runtime GLB from `characterMedium.fbx`, the pack's `idle.fbx`,
`jump.fbx`, and `run.fbx`, plus one selected skin. The reviewed export used
Blender 5.1.2, preserves 45 deform bones, embeds the source texture, and
contains the `Idle`, `Jump`, and `Run` clips. Runtime code swaps among six
reviewed skins from the two packs. `scripts/externalize-glb-images.mjs`
compacts the final GLB to 193.3 KiB and makes its source skin a direct
same-origin PNG so Chromium does not need a buffer-view blob URL.

The conversion deliberately binds Blender 4.4+ action slots before constructing
NLA tracks. Omitting those slots produces named clips whose characters remain
in the bind pose.

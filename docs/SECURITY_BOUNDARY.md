# Standalone security boundary

## Current capability surface

The current Shenron City build is a browser game backed only by files in this
repository.

| Capability | Current state |
|---|---|
| Render the 3D game | Yes |
| Read local game scenario data bundled at build time | Yes |
| Contact Mission Control or localhost APIs | No runtime path |
| Open WebSockets or server-sent events | No runtime path |
| Read the filesystem | No runtime path |
| Execute shell/native commands | No runtime path |
| Use Electron/Tauri/native bridges | No runtime path |
| Call an AI model/provider | No runtime path |
| Send analytics, errors, or telemetry | No runtime path |
| Fetch fonts/assets from an external host | Blocked and not required |

## Enforcement

The boundary is enforced in several layers:

1. `src/adapter/client.ts` was removed.
2. `vite.config.ts` has no proxy and disables HMR WebSockets.
3. `index.html` sets `connect-src 'none'`.
4. In-world labels use `ui/WorldText.tsx`, which creates canvas textures from a
   built-in generic font.
5. `scripts/verify-standalone-build.mjs` scans executable source and production
   output for network/native integration paths. It also rejects launcher
   regressions such as environment-file setup, unlocked `npm install`, and
   obsolete connected/demo-mode guidance.
6. `src/adapter/store.test.ts` proves startup and profile refresh never call
   `fetch` or construct a WebSocket.

## NPC and office behavior

Secretary replies are deterministic strings derived from local scenario data.
Office panels read the same local state. Text entered by the player is display
input for the scripted intent classifier; it cannot become a command.

## Future boundary

The long-term vision includes approved Mission Control and desktop
capabilities, but they are not authorized in this phase. When introduced, they
must use:

- an explicit connected mode,
- versioned schemas and runtime validation,
- narrow allowlisted commands,
- authentication and least privilege,
- timeouts and audit logs,
- user confirmation for consequential actions,
- no arbitrary shell,
- no secrets in the game bundle,
- tests proving free-form NPC text cannot invoke actions.

No future bridge should be enabled merely by importing a package or setting an
environment variable. Reconnection requires a separate reviewed implementation
and approval.

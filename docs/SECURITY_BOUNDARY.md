# AI Headquarters — security boundary

What the game can and cannot do, and why the secretary does not run on a
language model.

## Current capability surface

The game is a **browser page that reads three endpoints on localhost.** That is
the entire surface.

| Capability | State |
|---|---|
| Read Mission Control status / agents / metrics | Yes, session-authenticated |
| Receive backend broadcast events | Yes, read-only, unknown types dropped |
| Re-read one agent's record | Yes — the single "action", and it is a read |
| Mutate any Mission Control state | **No path exists** |
| Start, stop, pause, approve anything | **No path exists** |
| Execute a shell command | **No path exists** |
| Read the filesystem | **No path exists** |
| Hold a provider API key | **No** — see below |

There is no desktop bridge. Tauri was rejected (see [`STACK_DECISIONS.md`](STACK_DECISIONS.md));
the repo already ships an Electron shell, and adding a second native wrapper to
gain nothing the slice needs is not a trade worth making. **When a bridge is
built, none of the above changes by default** — it gets its own allowlist,
its own audit log, and per-action confirmation.

## Why there are no keys in this bundle

The client never talks to a model provider. All requests go to same-origin
`/api`, proxied by Vite to `127.0.0.1:9120`. The backend already owns provider
credentials and reads them from `$HERMES_HOME/.env`.

This is why `vercel/ai` was rejected outright. It is a good library, but it is
designed to run where the key is, and in a browser bundle that means shipping
the key to the client. Anything a user can view-source, they can extract.

The session token lives in a private class field, not `localStorage` — a token
in `localStorage` outlives the tab and widens the blast radius of any XSS in any
dependency.

## Why the secretary is grounded, not generative

Every fact she states is read out of the validated snapshot. She does not call a
model.

This is a design decision, not an unfinished feature. When the number of running
tasks is sitting in a typed struct, asking a language model to report it
introduces the possibility of a wrong answer for no gain. A control surface that
confidently misreports system state is worse than no control surface. She
answers what she can verify and says so plainly when she cannot:

> "That's outside what I can answer accurately. I only speak from what Mission
> Control actually reports… I'd rather say I don't know than invent it."

She also volunteers the caveat when data is stale or fixture:

> "I should say: I've lost contact with Mission Control, so this is the last
> reading I got, not live."

A model seam exists (`Reply.source === 'model'`) for genuinely open-ended
conversation. **Enabling it is a decision to be made deliberately**, because it
means routing through the backend, which means a request that can spend tokens.
It is not wired.

## NPC output is data, never a command

`agents/dialogue.ts` produces strings. Those strings are rendered into a DOM
panel. There is no path from dialogue text to an action, a fetch, an `eval`, or
a future desktop bridge.

An NPC that says "restart the gateway" produces the sentence. It does not
restart the gateway. This holds by construction: the dialogue module imports
nothing that can act, and `OfficePanel` — the only component that calls the
adapter — is driven by explicit button presses, never by dialogue content.

This matters more once a model is in the loop, because model output is
attacker-influenceable: an agent's `IDENTITY.md` or a task description is
untrusted text that could contain instructions. Treating all of it as display
data is the property that has to survive.

## The one action, and why it is that one

`requestStatusSummary(agentId)` re-reads `GET /api/agents/{id}`.

It was chosen because it is the *least* consequential thing that still proves
the whole round trip — auth, validation, rendering, error handling. It takes no
free-form input (`agentId` is regex-validated `^[A-Za-z0-9._-]{1,64}$` before
use), so there is nothing for dialogue to smuggle through, and the panel states
its own limits to the user:

> Read-only. This panel can request a status summary; it cannot start, stop,
> pause or approve anything.

Anything that mutates state gets an approval flow of its own before it ships —
not a button placed next to a read.

## Network posture

- Binds `127.0.0.1` only, both game (9122) and API (9120).
- Same-origin via the Vite proxy; the backend's CORS allowlist was **not**
  widened to accommodate the game.
- No analytics, no error reporting, no telemetry leaves the machine.
- Every response is validated before it reaches a component; unknown WS message
  types are dropped rather than forwarded half-understood.

### One external dependency, and it should be removed

`drei`'s `<Text>` is built on `troika-three-text`, which resolves fonts through
`unicode-font-resolver`. With no explicit `font` prop it fetches font data from
`https://cdn.jsdelivr.net/gh/lojjic/unicode-font-resolver@v1.0.1/...` the first
time a glyph is rendered. The string is present in the production bundle.

This is the only host outside `127.0.0.1` the game can contact. It carries no
user data — it is a font request — but it is still wrong for a local-first
control surface:

- In-world text (signage, office monitors, name plates) will not render offline
  or on an air-gapped machine.
- It is a runtime dependency on a third-party CDN for a tool that otherwise
  needs nothing but localhost.

**Fix:** ship one open-licence WOFF in `public/` and pass it explicitly —
`<Text font="/fonts/…woff">`. troika then never consults the resolver. Not done
here because the repo has no binary assets yet and adding the first one is a
deliberate decision (it is also where Git LFS starts mattering — see
[`STACK_DECISIONS.md`](STACK_DECISIONS.md)).

Until then, treat "no external hosts" as *aspirational, not yet true*.

## Not yet done

- No Content-Security-Policy header on the dev server.
- The dev build exposes `window.__rt` for console inspection. It is guarded by
  `import.meta.env.DEV` and stripped from production builds.
- No audit log of game-initiated reads. Worth adding when the first write lands.

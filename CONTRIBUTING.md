# Contributing to Shenzhen City

Shenzhen City is being built as a standalone Three.js web game. Keep changes
small, playable, and easy for another contributor to review.

## Before you edit

1. Update your local `main` from `origin/main`.
2. Create a focused branch; do not develop directly on `main`.
3. Tell the other contributor which files or system you are changing.
4. If someone already owns the same files, split the work or wait instead of
   creating a conflict that must be guessed through later.

```bash
git switch main
git pull --ff-only origin main
git switch -c feature/short-description
```

Do not reset, clean, or overwrite another contributor's uncommitted work. If
your checkout is dirty, either preserve it or create a separate Git worktree.

## Project boundaries

- The current game is standalone. Do not add network calls, host filesystem
  access, a desktop bridge, model-provider code, telemetry, multiplayer, or
  Mission Control integration in an ordinary gameplay PR.
- Do not add Unreal project files. The active runtime is Vite + React + Three.js
  through React Three Fiber.
- Shared city geometry and collision belong in renderer-free data.
- Frame-rate simulation belongs outside React state.
- Repeated scenery and crowds should be instanced when practical.
- Do not commit generated `dist/`, installed `node_modules/`, secrets, or local
  environment files.

## Verify locally

Install exactly what the lockfile specifies, then run the same gates as CI:

```bash
npm ci
npm run check
npm audit --audit-level=high
```

For visual changes, also enter the game in a browser, check low and high
quality, and play the affected route.

## Pull requests

- Use a descriptive title that says what the change accomplishes.
- Keep unrelated cleanup out of the PR.
- Describe visible behavior, boundary changes, and exact verification.
- Add or update focused tests for deterministic gameplay logic.
- Wait for CI before merging.
- Prefer a merge commit when preserving several meaningful commits; use a
  squash merge only when the branch history is disposable.

GitHub shows the latest commit touching each file in the repository list.
Files changed together will therefore show the same commit title; detailed
per-file behavior belongs in the commit body and PR description.

## Resolving conflicts

Fetch first and rebase your branch onto the current remote default branch:

```bash
git fetch origin
git rebase origin/main
```

Resolve each marked file by understanding both changes, run the full checks,
then continue the rebase. Never select "ours" or "theirs" across the whole
repository just to make the conflict marker disappear.

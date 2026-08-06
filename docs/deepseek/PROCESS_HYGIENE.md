# Process Hygiene (2026-08-06)

Why this exists: repeated agent interruptions left zombie processes behind
(vite dev servers, framecheck/lod-recheck runners, headless Chrome, stale
blender-mcp instances). They held ports, burned memory (5.8 GB free on a
31 GB machine), and contributed to opencode sessions appearing stuck, which
led to more restarts, which spawned more zombies.

## Rules (mandatory for every worker session)

1. **Own your processes.** Every server you spawn (vite, headless Chrome,
   node runners) must be killed by your own script before it exits — even on
   error. Use a `finally`/cleanup block or a `trap`-equivalent. `taskkill
   /PID <pid> /T /F` kills a tree; `Stop-Process -Id <pid> -Force` for one.
2. **Unique ports and temp dirs.** Never reuse another branch's dev-server
   port or Chrome `--remote-debugging-port` or `--user-data-dir`. Ports are
   assigned per branch in the worker brief. Check `Get-NetTCPConnection
   -State Listen -LocalPort <port>` before binding.
3. **Timeouts on every command.** A long command without an explicit timeout
   (Blender rebuilds, pipeline runs) can hang the caller. Always pass a
   generous-but-finite timeout and print progress markers.
4. **No `Start-Process` fire-and-forget.** If you must background a server,
   keep its PID, log its output to a file, and kill it in your cleanup.
5. **Never leave `node_modules`, `dist/`, or build outputs dirty in the
   worktree** — `git status` must be clean (or only intended files) when you
   finish, exactly as the worker brief requires.
6. **Check for stragglers before you start and after you finish:**
   `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object
   { $_.CommandLine -match 'vite|manhattan-threejs|scripts/qa' }` and the
   equivalent for headless Chrome (`-match '--headless'`).

## Zombie sweep (2026-08-06, already executed)

Killed: 3 stale vite servers (ports 5174/5180/5181), `framecheck-run.mjs`
(alive 5.5 h), `lod-recheck.mjs`, 2 headless Chrome instances, and the
opencode-spawned blender-mcp processes. Blender MCP is now disabled in
`C:\Users\xxvov\.config\opencode\opencode.jsonc` (it spawned at every
opencode start while Blender was not running, which stalls startup).

## Signs a session is genuinely stuck vs just slow

- Stuck-with-no-output for > 3 min on a command that prints nothing: check
  the command's child processes and the opencode log
  (`%USERPROFILE%\.local\share\opencode\log\opencode.log`) for
  `stream error` entries — model stream errors on subagents surface as
  hangs in the caller session.
- If a subagent's tool call never returns: kill its spawned processes from
  outside, then abort/restart the session. Do not spawn fresh servers on the
  same ports before confirming the old ones are dead.

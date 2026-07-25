# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm install
pnpm tauri dev                  # run overlay (macOS suppresses notifications for the unbundled dev binary)
pnpm tauri build                # -> src-tauri/target/release/bundle/macos/AgentPeek.app
pnpm build                      # tsc + vite build only (no Rust)
npx tsc --noEmit                # frontend types
node plugin/hooks/test-hook.cjs # hook logic tests (also: pnpm test:hook)
node scripts/make-tray-icons.cjs # regenerate menu-bar template icons
```

There is no test framework and no linter. `test-hook.cjs` is a plain `node:assert` script — no runner, no
single-test selection; add assertions to it and run the whole file. It writes into the real
`~/.agentpeek/sessions/` using a fixed UUID and cleans up after itself.

Verify the overlay without a live agent by hand-writing a session file — see the snippet in `README.md`.

## Architecture

Three processes, one file per session, no server:

```
Claude Code ──hook──► ~/.agentpeek/sessions/<uuid>.json ──poll 1s──► overlay + tray + notifications
```

**1. `plugin/hooks/agentpeek-hook.cjs`** — a Claude Code plugin hook wired to 7 lifecycle events
(`plugin/hooks/hooks.json`). Reads the hook payload on stdin, merges into the session file, exits 0.

Rules it must keep:
- **Never fail loudly.** A throwing hook degrades every Claude session on the machine — everything is
  wrapped and the exit code is always 0.
- **Reject, don't sanitize** `session_id`: it must match the UUID regex or the write is dropped.
- **Atomic writes** (tmp + `rename`) — the overlay polls the directory and would otherwise read
  truncated JSON.
- **It is the reducer.** All classification (`describeTool`, `classifyKind`, error streaks, token
  parsing) happens here. The session file's non-`events` fields are a materialised view of `events[]`,
  not a second source of truth. The UI is a pure renderer and never re-inspects tool names.

**2. `src/` (React)** — `useSessions.ts` polls, filters stale sessions and holds completed cards for
15s; `App.tsx` derives capsule-vs-expanded from click + attention (no timers — clicking the shell
toggles, and an outside click arrives as the `overlay:blur` event described below); `activity.ts` maps
`EventKind`/`Status` to the orb animation and timeline captions.

**3. `src-tauri/src/overlay.rs`** — sole owner of native window behaviour, behind a state machine with
documented invariants in its module header. Read them before touching anything window-related.
Nothing outside that module may call `set_size` / `set_position` / `show` / `hide` or reach for
`ns_window`; the frontend gets exactly four commands, wrapped in `src/overlay.ts`. All native calls go
through `run_on_main_thread`. A Rust keepalive thread redocks every 2s because a webview that stops
being composited also has its timers throttled — the repair loop cannot live in JS.
`AGENTPEEK_TRACE=1` logs level / collection behaviour / `isOnActiveSpace` on every reassert.

### Contracts

- **`src/protocol.ts` is hand-synced with the hook.** Change the state shape in one and you must change
  the other. `AgentEvent` carries an `agent` field so a second adapter only needs to write the same JSON.
- Agent status comes from `LSUIElement` in `src-tauri/Info.plist`, never a runtime
  `set_activation_policy` call — doing it at runtime strands the window off the active Space
  permanently (see the comment there).
- Window size is driven by content: `useOverlaySize.ts` measures the panel and reports it; `html/body`
  are `width/height: max-content` so measurement is never clamped by the current window size.
  Grow immediately, shrink after the spring settles.

### Design constraints worth knowing before "fixing" them

- The context capsule is **context usage, not progress** — agents expose no progress and a heuristic
  one would be invented.
- A session is marked `error` only after 3 consecutive failed tool calls; one failing test is normal.
- Stale sessions (>10min quiet) are dropped, **except** ones needing attention.
- Motion respects `prefers-reduced-motion`.
- Deliberate simplifications are marked with `ponytail:` comments (polling over file watching, 200-file
  cap, two token-window buckets).

`README.md` says the glass is a real `NSVisualEffectView` in `lib.rs` — that is stale. The current
surface is an opaque CSS panel (`.panel` in `src/App.css`); there is no vibrancy code in `src-tauri`.

### Reference docs

`AgentPeek.md` (original product brief, multi-agent vision) and `REDESIGN.md` (UI/UX direction) are
aspirational specs, not descriptions of the current code. Shipped scope is Claude Code only, via hooks.

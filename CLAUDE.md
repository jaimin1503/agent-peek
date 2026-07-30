# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm install
pnpm tauri dev                  # run overlay (no notifications from the unbundled dev binary, macOS or Windows)
pnpm tauri build                # -> bundle/macos/AgentPeek.app, or bundle/nsis/*-setup.exe on Windows
pnpm build                      # tsc + vite build only (no Rust)
npx tsc --noEmit                # frontend types
node plugin/hooks/test-hook.cjs # hook logic tests (also: pnpm test:hook)
node scripts/make-tray-icons.cjs # regenerate menu-bar template icons

git tag v0.1.1 && git push --tags   # -> .github/workflows/release.yml builds a DRAFT release
```

Two workflows, and they do not overlap:

- **`.github/workflows/ci.yml`** — every PR and every push to `main`. Hook tests, `tsc`, `pnpm build`
  and `cargo check` on macOS *and* Windows runners. The Windows leg is not redundant: it is the only
  machine that compiles the `cfg(target_os = "windows")` half of `focus_app`, since `cargo check
  --target x86_64-pc-windows-msvc` cannot run from macOS (`tauri-build` needs `llvm-rc`). Produces no
  artifacts.
- **`.github/workflows/release.yml`** — tags only. Builds macOS arm64, macOS x64 and Windows x64 and
  attaches them to a **draft** GitHub release you publish by hand.

Bump the version in `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` and
`plugin/.claude-plugin/plugin.json` together — nothing keeps them in sync. Builds are deliberately
unsigned; `README.md` tells users what Gatekeeper and SmartScreen will say. There is no updater
plugin, so upgrading means downloading the new installer.

There is no test framework and no linter. `test-hook.cjs` is a plain `node:assert` script — no runner, no
single-test selection; add assertions to it and run the whole file. It writes into the real
`~/.agentpeek/sessions/` using a fixed UUID and cleans up after itself.

Verify the overlay without a live agent by hand-writing a session file — see the snippet in `README.md`.

## Architecture

Three processes, one file per session, no server:

```
Claude Code ──hook──► ~/.agentpeek/sessions/<uuid>.json ──poll 1s──► overlay + tray + notifications
                                   │
                             on SessionEnd
                                   ▼
                      ~/.agentpeek/history/<uuid>.json ──read on focus──► history window
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
- **It owns the whole lifecycle of a session file.** `SessionEnd` *archives* (`archive()`: write
  `history/`, then unlink `sessions/` — in that order, so a crash loses the live copy and not the
  permanent one). `SessionStart` also runs `sweep()`, which archives anything in `sessions/` quiet for
  longer than `STALE_MS` — a killed process never fires `SessionEnd`, and nothing else would ever move
  its file.

**2. `src/` (React)** — two entries, two windows, shared components.
- **Overlay** (`index.html` → `main.tsx`): `useSessions.ts` polls, filters stale sessions and holds
  completed cards for 15s; `App.tsx` derives capsule-vs-expanded from click + attention (no timers —
  clicking the shell toggles, and an outside click arrives as the `overlay:blur` event described
  below); `activity.ts` maps `EventKind`/`Status` to the orb animation and timeline captions.
- **History** (`history.html` → `History.tsx`): an ordinary window, opened from the tray, hidden
  rather than closed (see `on_window_event` in `lib.rs`). It reads `history/` + `sessions/` through
  `readSessionDir` on mount and on every `focus`, then does search/projects/stats with `filter` and
  `reduce` — there is no database, and `History.css` exists only to undo App.css's `max-content`
  html/body, which is an overlay-measurement trick a real window must not inherit.
- Anything new that renders sessions belongs in a shared component, not a second copy: `Timeline`
  takes `limit`/`time` props precisely so the overlay's 4-row tail and history's full timestamped log
  are the same component.

**3. `src-tauri/src/overlay.rs`** — sole owner of native window behaviour, behind a state machine with
documented invariants in its module header. Read them before touching anything window-related.
Nothing outside that module may call `set_size` / `set_position` / `show` / `hide` or reach for
`ns_window`; the frontend gets exactly four commands, wrapped in `src/overlay.ts`. All native calls go
through `run_on_main_thread`. A Rust keepalive thread redocks every 2s because a webview that stops
being composited also has its timers throttled — the repair loop cannot live in JS.
`AGENTPEEK_TRACE=1` logs level / collection behaviour / `isOnActiveSpace` on every reassert.

### Platforms

macOS is where the hard window work is; Windows and Linux take a deliberately smaller contract, also
documented in the `overlay.rs` header. Everything ObjC sits behind `cfg(target_os = "macos")` with a
`cfg(not(...))` counterpart — shared behaviour is written as `not(macos)` so Linux gets it too, though
only Windows is tested.

- `promote_to_panel` / `watch_outside_clicks` are no-ops off macOS. The overlay is an ordinary window
  there, so `WindowEvent::Focused(false)` is what emits `overlay:blur`, and `reassert` re-applies
  `set_always_on_top` because Windows silently demotes topmost windows.
- `focus_app` in `lib.rs` has three bodies: `open -a` (macOS), `EnumWindows` + `SetForegroundWindow`
  against a process image name (Windows, via the `windows` crate under a `cfg(target_os = "windows")`
  dependency block), and an error on Linux. `name` must never be treated as something to execute.
- The hook's `terminalApp(env, platform)` decides what that name is, and returns `null` — greying the
  card's button out — wherever it cannot tell.
- Two tray icon pairs: black (macOS template) and white (everywhere else, since nothing else
  recolours). `iconsAreTemplate` in `trayIcons.ts` picks, and drives `iconAsTemplate`.
- `cargo check --target x86_64-pc-windows-msvc` does **not** work from macOS — `tauri-build` needs
  `llvm-rc` for the Windows resource. Type-check Win32 changes by copying the function into a scratch
  crate that depends only on `windows`, or on a Windows machine.

### Contracts

- **`src/protocol.ts` is hand-synced with the hook.** Change the state shape in one and you must change
  the other. `AgentEvent` carries an `agent` field so a second adapter only needs to write the same JSON.
- Agent status comes from `LSUIElement` in `src-tauri/Info.plist`, never a runtime
  `set_activation_policy` call — doing it at runtime strands the window off the active Space
  permanently (see the comment there).
- Window size is driven by content: `useOverlaySize.ts` measures the panel and reports it; `html/body`
  are `width/height: max-content` so measurement is never clamped by the current window size.
  Grow immediately, shrink after the spring settles.
- **`on_window_event` in `lib.rs` returns early for the `history` label.** Forwarding a second window's
  events into `OverlayWindow` would redock the overlay whenever history moved and — off macOS, where
  `Focused(false)` *is* the outside-click signal — collapse the panel whenever history was dismissed.
- **Two Vite entries.** A new window means an entry in `build.rollupOptions.input` *and* in
  `tauri.conf.json`'s `app.windows`, *and* its label in `capabilities/default.json` — a window absent
  from that list gets no `fs` permission and reads an empty directory.

### Design constraints worth knowing before "fixing" them

- The context capsule is **context usage, not progress** — agents expose no progress and a heuristic
  one would be invented.
- A session is marked `error` only after 3 consecutive failed tool calls; one failing test is normal.
- Stale sessions (>10min quiet) are dropped from the overlay, **except** ones needing attention — and
  archived to `history/` by the next `SessionStart` sweep, so dropped never means lost.
- History is **two directories of JSON, not a database.** The session files already are the
  event-sourced record, so search/stats/timeline are `filter`/`reduce` over them. The ceiling is
  memory: every session is loaded when the window opens, which is fine for thousands of ~5KB files.
  SQLite earns its place past that, or when something outside this process needs to query — not before.
- Archived timelines are capped at `MAX_EVENTS` (50) like live ones. Raising it costs disk per session,
  not runtime.
- Motion respects `prefers-reduced-motion`.
- Deliberate simplifications are marked with `ponytail:` comments (polling over file watching, 200-file
  cap, two token-window buckets, no database behind history).

The surface is an opaque CSS panel (`.panel` in `src/App.css`) — there is no vibrancy code in
`src-tauri`, whatever an older draft of the README claimed.

### Reference docs

`AgentPeek.md` (original product brief, multi-agent vision) and `REDESIGN.md` (UI/UX direction) are
aspirational specs, not descriptions of the current code. Shipped scope is Claude Code only, via hooks.

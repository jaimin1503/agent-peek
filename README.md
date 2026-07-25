# AgentPeek

An always-on-top overlay that shows what your Claude Code sessions are doing, so you can leave the
terminal and only come back when something actually needs you.

A card per live session on a real macOS glass surface: a status orb that animates what the agent is
doing, the current activity, elapsed time, an activity timeline, and context usage. One card carries
detail at a time — whichever session needs you, or whichever you hover. Sessions needing attention
sort to the top, tint amber, and fire a native notification on the transition.

```
╭──────────────────────────────────╮
│  ◉    emgage-ess          3m 24s │   ◉ breathes, spins, shimmers or pulses
│       Editing PayrollActions.tsx │     depending on what it is doing
│                                  │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░       145k  │   context window, not fake progress
│                                  │
│  ·  Read 42 files                │
│  ·  Edited ColorProcessor.kt     │
│  ▸  Ran npm test                 │
│                                  │
│  ⟨12 files⟩ ⟨73% context⟩        │
╰──────────────────────────────────╯
```

The window sizes itself to its content, so it is a 40px pill when idle and only as tall as it needs
to be otherwise.

## How it works

A Claude Code plugin hook appends an `AgentEvent` to one JSON file per session in
`~/.agentpeek/sessions/`. The overlay polls that directory once a second and renders it. No server,
no ports, no daemon — which also means multiple concurrent sessions and app restarts work with no
extra machinery.

```
Claude Code ──hook──► ~/.agentpeek/sessions/<id>.json ──poll──► overlay + tray + notifications
```

Each file carries an append-only `events[]` (the canonical record, last 50) plus the state derived
from it. The derivation runs in the hook — it is a materialised view, not a second source of truth —
so the UI stays a renderer and the reducer stays under test in `test-hook.cjs`.

Everything the UI understands is in [`src/protocol.ts`](src/protocol.ts). The event shape carries an
`agent` field, so a Gemini/Codex/Aider adapter only has to write the same JSON.

The glass is a real `NSVisualEffectView` applied in [`src-tauri/src/lib.rs`](src-tauri/src/lib.rs),
not CSS. `backdrop-filter` cannot do this: in a transparent window it samples only what is behind the
element *within the page*, which is nothing, so it renders as a flat rectangle.

## Install

**1. The hook** (publishes session state)

In any Claude Code session:

```
/plugin marketplace add /Users/jaiminv/Documents/AgentPeek
/plugin install agentpeek@agentpeek
```

This installs as a plugin, so it does not touch your `~/.claude/settings.json`. Uninstalling the
plugin removes the hooks.

**2. The overlay**

```bash
pnpm install
pnpm tauri build          # produces src-tauri/target/release/bundle/macos/AgentPeek.app
```

Then drag `AgentPeek.app` to `/Applications` and launch it. For development, `pnpm tauri dev` — note
that macOS suppresses notifications for the unbundled dev binary, so notification behaviour must be
checked against the built `.app`.

## Verify

```bash
node plugin/hooks/test-hook.cjs     # hook logic: tool messages, path safety, status transitions
npx tsc --noEmit                   # frontend types
```

To exercise the overlay without waiting for a real agent, write a session file by hand:

```bash
mkdir -p ~/.agentpeek/sessions
cat > ~/.agentpeek/sessions/11111111-1111-1111-1111-111111111111.json <<EOF
{"agent":"claude","sessionId":"11111111-1111-1111-1111-111111111111",
 "cwd":"/tmp/demo","status":"permission","message":"needs approval",
 "startedAt":$(($(date +%s)*1000-60000)),"updatedAt":$(($(date +%s)*1000)),
 "filesTouched":[],"terminalApp":"Visual Studio Code"}
EOF
```

The card appears within a second. Delete the file and it disappears.

## Notes

- **Stale sessions.** A session killed with `kill -9` never fires `SessionEnd`, so any session quiet
  for 10 minutes is dropped — unless it is waiting on you, which is the one state that must never be
  silently hidden.
- **Finished sessions linger 15s.** `SessionEnd` deletes the file the instant Claude exits, so the
  overlay holds a completed card briefly rather than blinking it out of existence mid-ripple.
- **Bring Terminal** uses the `TERM_PROGRAM` captured by the hook. Unmapped terminals leave the
  button disabled rather than guessing.
- **Errors.** There is no hook that means "the agent is stuck", so a session is marked red only after
  three consecutive failed tool calls. A single failing test is normal and stays green.
- **The capsule is context usage, not progress.** Agents do not expose progress and a heuristic one
  would be invented. Context pressure is real, moves only forward, and is worth knowing about.
- **No "tests passed" summary.** Nothing reports test results to any hook, so the completed card
  shows files changed and elapsed time and stops there.
- **Motion respects `prefers-reduced-motion`** — an always-on-top overlay that ignores it is genuinely
  unpleasant.
- **Typography** is `system-ui` (SF Pro) and `ui-monospace` (SF Mono), both already on macOS. The
  brief asked for JetBrains Mono; it is not installed and would mean bundling a woff2, and SF Mono
  pairs better with SF Pro. One line in `App.css` if you want to swap.
- **The menu bar icon is monochrome** — a ring at rest, filled when something wants you. Template
  imagery is the macOS convention; status colour lives in the overlay where it can carry meaning.
  Regenerate with `node scripts/make-tray-icons.cjs`.

## Scope

Claude Code only, via hooks. Not built yet, and why: the wrapper and PTY fallbacks (hooks make them
unnecessary), other agent adapters (nothing to abstract over until the second one exists), git
integration, light mode, and a settings window.
# agent-peek

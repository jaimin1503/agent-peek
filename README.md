# AgentPeek

An always-on-top overlay that shows what your Claude Code sessions are doing, so you can leave the
terminal and only come back when something actually needs you.

A card per live session: a status orb that animates what the agent is
doing, the current activity, elapsed time, an activity timeline, and context usage. One card carries
detail at a time — whichever session needs you, or whichever you click. Sessions needing attention
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

The surface is an opaque CSS panel (`.panel` in `src/App.css`). `backdrop-filter` was never an option
— in a transparent window it samples only what is behind the element *within the page*, which is
nothing, so it renders as a flat rectangle — and real vibrancy would have been macOS-only.

## Platforms

| | macOS | Windows | Linux |
| --- | --- | --- | --- |
| Hook, session files, notifications | ✅ | ✅ | ✅ |
| Overlay, tray, click-to-expand | ✅ | ✅ | untested |
| Click outside to collapse | global `NSEvent` monitor | window loses focus | window loses focus |
| Over another app's fullscreen | ✅ non-activating `NSPanel` | borderless only | — |
| Bring Terminal | `open -a` | `EnumWindows` + `SetForegroundWindow` | ✗ button disabled |
| Never steals focus | ✅ | clicking the card focuses it | clicking the card focuses it |

Two Windows caveats worth knowing before filing a bug:

- **Toast notifications only fire from the installed build.** Windows resolves them through the
  AppUserModelID that the NSIS installer registers, so `pnpm tauri dev` shows nothing. Same shape as
  the macOS dev-binary caveat below.
- **An *exclusive*-fullscreen game covers the overlay.** Borderless fullscreen — what most apps and
  every editor use — is fine.

The window-behaviour differences and their reasoning live in the module header of
[`overlay.rs`](src-tauri/src/overlay.rs).

## Install

Two halves, and you need both: a **plugin** that publishes session state, and an **app** that displays
it.

### 1. The plugin

In any Claude Code session:

```
/plugin marketplace add jaimin1503/agent-peek
```
```
/plugin install agentpeek@agentpeek
```

(The full `https://github.com/jaimin1503/agent-peek` URL works in place of the shorthand.)

Nothing else to configure. It installs as a plugin rather than editing your
`~/.claude/settings.json`, so `/plugin uninstall agentpeek@agentpeek` removes the hooks cleanly.

It needs `node` on your `PATH` — the same Node you already have if you installed Claude Code through
npm.

### 2. The app

Grab the build for your machine from the [latest
release](https://github.com/jaimin1503/agent-peek/releases/latest):

| Your machine | File |
| --- | --- |
| Mac, Apple Silicon (M1–M4) | `AgentPeek_<version>_aarch64.dmg` |
| Mac, Intel | `AgentPeek_<version>_x64.dmg` |
| Windows | `AgentPeek_<version>_x64-setup.exe` |

Not sure which Mac you have: Apple menu → About This Mac. "Chip" means Apple Silicon, "Processor"
means Intel.

Launch it and there is no window and no Dock icon — that is correct. AgentPeek lives in the menu bar
(macOS) or the notification area (Windows), and the overlay appears at the top of your screen the
moment a Claude Code session starts.

#### Installing on macOS

AgentPeek is distributed as an unsigned open-source build. Signing an app for distribution requires a
paid Apple Developer account, so Gatekeeper does not recognise this one and will refuse the first
launch — the wording Apple uses is that the app *"is damaged and can't be opened."* Nothing is
damaged; that message is what macOS shows for any app it cannot verify.

Open the `.dmg`, drag **AgentPeek** to your Applications folder, then run:

```bash
xattr -dr com.apple.quarantine /Applications/AgentPeek.app
```

That clears the quarantine flag macOS attaches to downloaded files. Open the app normally afterwards;
you only ever do this once per download.

If you would rather not run that, [build it yourself](#build-it-yourself) — an app you compiled
locally is never quarantined.

#### Installing on Windows

Same situation, different wording: the installer is unsigned, so SmartScreen shows **"Windows
protected your PC."** Click **More info → Run anyway**.

Install it rather than running the app in place — registering the installer is what lets Windows
deliver AgentPeek's toast notifications.

#### Upgrading

There is no auto-updater yet. New versions are announced on the
[releases page](https://github.com/jaimin1503/agent-peek/releases); download and install over the top
of the old one. Your sessions live in `~/.agentpeek/` and are untouched by an upgrade.

### Build it yourself

Everything is here; the release artifacts are just these commands run on GitHub's machines. Needs
[Rust](https://rustup.rs), Node 20+, and [pnpm](https://pnpm.io).

```bash
git clone https://github.com/jaimin1503/agent-peek.git
cd agent-peek
pnpm install
pnpm tauri build
```

Output follows the host:

- **macOS** — `src-tauri/target/release/bundle/macos/AgentPeek.app` (and a `.dmg` beside it in
  `bundle/dmg/`). Drag it to `/Applications`.
- **Windows** — `src-tauri/target/release/bundle/nsis/AgentPeek_<version>_x64-setup.exe`.
- **Linux** — untested, and needs `libayatana-appindicator3-dev` at build time for the tray.

For development, `pnpm tauri dev` — note that neither macOS nor Windows delivers notifications for the
unbundled dev binary, so notification behaviour must be checked against the installed build.

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

The card appears within a second. Delete the file and it disappears. On Windows the same file goes in
`%USERPROFILE%\.agentpeek\sessions\`; use `"terminalApp": "WindowsTerminal.exe"` to exercise the
button.

## Notes

- **Over fullscreen apps the overlay is an `NSPanel`.** A plain `NSWindow` does not join another
  app's native-fullscreen Space, whatever its level or collection behaviour — with
  `CanJoinAllSpaces | FullScreenAuxiliary | CanJoinAllApplications` at level 101 and an
  `orderOut`/`orderFrontRegardless` bounce every two seconds, `CGWindowListCopyWindowInfo` still did
  not list it as on-screen. macOS decides on the *kind* of window, and the kind that qualifies is a
  non-activating panel, so [`overlay.rs`](src-tauri/src/overlay.rs) re-classes the tao window at
  startup.
- **The window is declared `"visible": false`** and shown only after that re-class. Order is the
  whole fix: a window whose first order-in happened as a plain `NSWindow` is stuck on the Space it
  was born on, so launching while a fullscreen app was already frontmost meant the overlay never
  appeared there and nothing repaired it afterwards. Promote first, show second.
- **AppKit is no use for diagnosing any of this.** `isVisible` and `isOnActiveSpace` both report a
  perfectly healthy window that is not being composited — `isOnActiveSpace` in particular answers
  `true` for a `CanJoinAllSpaces` window stranded on a Space you left, which is why the repair it
  used to gate never ran. `occlusionState` is the one AppKit signal that agrees with
  `CGWindowListCopyWindowInfo`, and the on-screen list is the ground truth worth checking.
- **Click the card to expand it, click anywhere else to close it.** On macOS that outside click lands
  in another application, so the webview never sees it, and the usual hook — the window losing key
  status — does not exist either: a non-activating panel owned by an app that never activates is
  never key to begin with. A global `NSEvent` monitor is what remains, and it is exactly the right
  predicate, since it never reports its own application's events. Mouse monitoring needs no
  Accessibility permission. Elsewhere the overlay is an ordinary window that *can* be focused, so
  losing focus is the same signal for a tenth of the code — at the cost of one click bouncing focus
  off your terminal.
- **Stale sessions.** A session killed with `kill -9` never fires `SessionEnd`, so any session quiet
  for 10 minutes is dropped — unless it is waiting on you, which is the one state that must never be
  silently hidden.
- **Finished sessions linger 15s.** `SessionEnd` deletes the file the instant Claude exits, so the
  overlay holds a completed card briefly rather than blinking it out of existence mid-ripple.
- **Bring Terminal** uses the `TERM_PROGRAM` (or, on Windows, `WT_SESSION`) captured by the hook —
  an application name for `open -a` on macOS, an executable name matched against every top-level
  window's process on Windows. Unmapped terminals leave the button disabled rather than guessing, and
  the name is only ever compared, never run.
- **Errors.** There is no hook that means "the agent is stuck", so a session is marked red only after
  three consecutive failed tool calls. A single failing test is normal and stays green.
- **The capsule is context usage, not progress.** Agents do not expose progress and a heuristic one
  would be invented. Context pressure is real, moves only forward, and is worth knowing about.
- **No "tests passed" summary.** Nothing reports test results to any hook, so the completed card
  shows files changed and elapsed time and stops there.
- **Motion respects `prefers-reduced-motion`** — an always-on-top overlay that ignores it is genuinely
  unpleasant.
- **Typography** is Cascadia Mono throughout, bundled as a woff2 in `src/fonts/` so it renders
  identically on every platform, with `ui-monospace` behind it as the fallback. The brief asked for
  JetBrains Mono; two lines in `App.css` if you want to swap.
- **The tray icon is monochrome** — a ring at rest, filled when something wants you. Status colour
  lives in the overlay where it can carry meaning. There are two pairs, because only macOS recolours a
  template image for the current appearance: black there, white everywhere else, which is a bet on the
  default dark Windows taskbar. Regenerate all four with `node scripts/make-tray-icons.cjs`.

## Scope

Claude Code only, via hooks. Not built yet, and why: the wrapper and PTY fallbacks (hooks make them
unnecessary), other agent adapters (nothing to abstract over until the second one exists), git
integration, light mode, and a settings window.

## Contributing

Issues and pull requests welcome. Two things worth reading first: `CLAUDE.md` for how the three
processes fit together, and the module header of [`overlay.rs`](src-tauri/src/overlay.rs) before
changing anything to do with the window — most of what looks redundant in there is load-bearing, and
the comments say which bug each part exists to prevent.

Run `node plugin/hooks/test-hook.cjs` and `npx tsc --noEmit` before opening a PR. There is no linter
and no test framework beyond that one `node:assert` script. CI runs those plus `pnpm build` and
`cargo check` on macOS and Windows, so a change that only compiles on the platform you happen to be
using gets caught there.

## License

[MIT](LICENSE).

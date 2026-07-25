# AgentPeek — Universal AI Coding Companion

> A lightweight desktop application that lets developers step away from their terminal while AI coding agents work, notifying them only when their attention is required.

---

# Vision

Modern AI coding assistants (Claude Code, Gemini CLI, Codex CLI, Aider, etc.) often spend several minutes reading files, editing code, and running tests.

During that time the user wants to:

- Watch YouTube
- Watch a movie
- Read documentation
- Browse the web
- Work in another application

The problem is that they must constantly switch back to the terminal because the AI may:

- Ask for permission
- Ask a follow-up question
- Finish successfully
- Encounter an error
- Become idle

This creates unnecessary context switching.

AgentPeek solves this by providing a small always-on-top overlay that continuously displays the AI's current state and only interrupts the user when attention is needed.

---

# Core Goals

The application should:

- Work with multiple AI coding agents
- Run entirely locally
- Consume minimal CPU and RAM
- Have a clean native macOS experience
- Be extensible through adapters
- Never require the user to keep watching the terminal

---

# Supported Agents (Initial)

- Claude Code
- Gemini CLI
- Codex CLI
- Aider

Future:

- Goose
- OpenHands
- Cursor Agent
- Windsurf Agent
- Custom agents

---

# Core Concept

Every supported AI should expose a common event stream.

Instead of the UI understanding Claude, Gemini, Codex separately, every adapter converts events into one shared protocol.

Example:

```text
Claude
      │
Gemini
      │
Codex
      │
 Aider
      │
      ▼
 Agent Adapter
      │
      ▼
 Standard Event
      │
      ▼
 Overlay UI
```

This keeps the frontend completely independent from the AI being used.

---

# Technology Stack

## Desktop

- Tauri v2
- React
- TypeScript
- Rust

Why Tauri?

- Native performance
- Tiny bundle size
- Low memory usage
- Native notifications
- Always-on-top windows
- Tray icon support
- Cross-platform

---

## UI

React

TypeScript

Tailwind CSS

Framer Motion (animations)

---

## Backend

Rust

Responsibilities:

- Native window management
- Notifications
- Tray icon
- Event handling
- Auto-launch
- IPC

---

## Communication

Preferred:

WebSocket

Fallback:

Local IPC

---

# High-Level Architecture

```text
                   +----------------------+
                   | AI Coding Assistant  |
                   | (Claude / Gemini...) |
                   +----------+-----------+
                              |
                              |
                    Adapter / Wrapper
                              |
                              |
                   Standard JSON Events
                              |
               +--------------+--------------+
               |                             |
               |                             |
          Event Bus                    Local API
               |
               |
      +--------+---------+
      |                  |
 Overlay Window     Tray Application
      |                  |
      +--------+---------+
               |
      Native Notifications
```

---

# Standard Event Protocol

Every adapter emits identical events.

Example:

```json
{
  "agent": "claude",
  "status": "working",
  "message": "Editing ColorProcessor.kt",
  "progress": 64,
  "elapsedSeconds": 142
}
```

Permission request:

```json
{
  "agent": "claude",
  "status": "permission",
  "command": "git reset --hard"
}
```

Finished:

```json
{
  "agent": "claude",
  "status": "completed",
  "duration": 531
}
```

Error:

```json
{
  "status": "error",
  "message": "Tests failed"
}
```

---

# Agent Adapters

Each supported AI has its own adapter.

```
ClaudeAdapter

GeminiAdapter

CodexAdapter

AiderAdapter
```

Each adapter translates native output into the common protocol.

---

# Claude Integration

Preferred priority:

## Option 1 — Claude Hooks (Preferred)

Use Claude Code hooks whenever possible.

Hooks can emit events like:

- Started
- Reading
- Thinking
- Editing
- Running tests
- Waiting
- Permission
- Finished

The hook simply sends a JSON message to AgentPeek.

Advantages:

- Extremely reliable
- No parsing
- Low latency

---

## Option 2 — Wrapper

Instead of

```bash
claude
```

users launch

```bash
agentpeek claude
```

The wrapper:

- Starts Claude
- Streams stdout
- Detects events
- Emits JSON

---

## Option 3 — Terminal Monitoring

Fallback.

Monitor PTY output.

Useful for unsupported agents.

Less reliable.

---

# Overlay UI

The overlay should always stay above normal windows.

Characteristics:

- Transparent background
- Click-through mode (optional)
- Draggable
- Resizable
- Adjustable opacity

---

Compact Mode

```text
🤖 Claude

Working...

Editing ExportCoordinator.kt

████████░░

3m 21s
```

---

Expanded Mode

```text
Claude Code

Current Task

Optimizing HEVC Export

Status

Running Tests

Files

✓ ExportCoordinator.kt

✓ ColorProcessor.kt

✓ RawProcessor.kt

Elapsed

5m 14s

Progress

████████░░░
```

---

# Attention Mode

If the AI needs user interaction, the overlay changes colour.

Example

```text
⚠ Claude needs approval

Execute:

rm -rf build/

[Bring Terminal]
```

or

```text
❓ Claude is asking a question

Continue?

[Open Claude]
```

---

# Completion Mode

```text
✅ Finished

Duration

8m 42s

Modified

12 files

Tests

Passed
```

---

# Notifications

Native macOS notifications.

Examples:

Permission required

```
Claude needs approval.
```

Question

```
Claude is waiting for your answer.
```

Finished

```
Claude completed successfully.
```

Error

```
Build failed.
```

Clicking a notification should:

- Bring terminal forward
- Focus Claude
- Dismiss notification

---

# Tray Application

A menu bar icon.

States:

🟢 Working

🟡 Waiting

🔵 Finished

🔴 Error

Menu:

```
Current Agent

Claude

Current Task

Editing files

Open Overlay

Pause Notifications

Settings

Quit
```

---

# Timeline

The overlay should keep a timeline.

Example

```
10:31 Started

10:32 Reading files

10:35 Planning

10:37 Editing

10:42 Tests

10:45 Waiting

10:47 Finished
```

---

# Optional Progress Estimation

Since AI agents don't expose progress, estimate based on stages.

Possible stages:

```
Planning

Reading

Editing

Testing

Building

Done
```

Each stage contributes to a heuristic progress estimate.

Never pretend this is exact.

---

# File Activity

Display recently modified files.

Example

```
Recently Modified

✓ ExportCoordinator.kt

✓ ColorProcessor.kt

✓ RawProcessor.kt

✓ Encoder.kt
```

---

# Git Integration

Show:

```
+18 modified files

+120 additions

-32 deletions
```

Optional:

```
Ready to commit
```

---

# Token Usage

If available:

```
Claude

145k / 200k context

72%
```

---

# Settings

General

- Launch at login
- Always on top
- Click-through mode
- Overlay opacity
- Compact mode
- Expanded mode
- Theme
- Animation speed

Notifications

- Completion
- Permission
- Questions
- Errors

Agent

- Claude
- Gemini
- Codex
- Auto detect

---

# Multi-Agent Support

Future versions should support multiple agents simultaneously.

Example

```
Claude

Running tests

Gemini

Idle

Codex

Planning
```

---

# Plugin Architecture

Every AI adapter should implement something similar to:

```typescript
interface AgentAdapter {
    start(): Promise<void>;

    stop(): Promise<void>;

    onEvent(callback: (event: AgentEvent) => void): void;
}
```

The UI never talks directly to Claude.

Only to adapters.

---

# Folder Structure

```
agentpeek/

apps/
    desktop/

packages/
    ui/
    protocol/
    adapters/
    shared/

rust/

docs/

assets/

scripts/
```

---

# Development Roadmap

## Phase 1

Desktop shell

- Tauri setup
- React
- Transparent overlay
- Always-on-top window
- Manual fake events

Goal:

UI prototype

---

## Phase 2

Event System

- Event bus
- JSON protocol
- IPC
- Live updates

Goal:

Overlay updates in real time

---

## Phase 3

Claude Adapter

- Wrapper
- Hooks
- Status detection
- Permission detection
- Completion detection

Goal:

Works with Claude Code

---

## Phase 4

Native Integration

- Notifications
- Tray icon
- Bring terminal to front
- Auto-launch

Goal:

Feels like a native macOS app

---

## Phase 5

Product Polish

- Animations
- Themes
- Settings
- Timeline
- Git integration

Goal:

Public beta

---

## Phase 6

Additional Agents

- Gemini CLI
- Codex CLI
- Aider
- Goose

Goal:

Universal AI companion

---

# Stretch Goals

- Floating "Dynamic Island"-style widget
- Live token usage graph
- Voice alerts
- Apple Shortcuts support
- Raycast extension
- VS Code extension
- Keyboard shortcuts
- Session history
- Export activity logs
- AI performance analytics
- Mobile companion app
- Apple Watch notifications

---

# Success Criteria

The user should be able to:

- Start Claude Code.
- Switch to another application (e.g., a movie, browser, or documentation).
- Leave the terminal untouched for extended periods.
- Instantly know:
  - What the AI is doing
  - Whether progress is being made
  - Whether permission is required
  - Whether the task has completed
  - Whether an error has occurred
- Return to the terminal only when necessary.

The experience should feel like a lightweight "mission control" for AI coding agents rather than another terminal window, enabling developers to trust their agents to work autonomously while staying informed through a clean, unobtrusive interface.
# AgentPeek v0.2 — Persistent Session History

> **Goal:** Transform AgentPeek from a live session overlay into a persistent AI coding session companion that remembers every Claude Code session while laying the foundation for MCP, analytics, and multi-agent support.

---

# Vision

Today AgentPeek answers:

> **"What is Claude doing right now?"**

v0.2 answers:

> **"What has Claude been doing over the last week?"**

The overlay remains unchanged.

Instead, AgentPeek gains a local event database, searchable session history, timelines, and project statistics.

Everything remains **100% local**.

---

# Design Principles

## Event Sourcing

Events are the source of truth.

Current session state is always derived from events.

Never mutate history.

Never overwrite events.

---

## Local First

No cloud.

No accounts.

No telemetry.

SQLite database stored locally.

---

## Fast

The overlay must remain exactly as responsive as today.

Database writes happen asynchronously.

History should never slow down live updates.

---

## Extensible

Everything built in v0.2 should become usable by:

- MCP Server
- Analytics
- Web Dashboard
- Mobile Companion
- Future AI adapters

without redesigning storage.

---

# Goals

## Primary Goals

✅ Persistent session history

✅ Searchable timelines

✅ Project statistics

✅ SQLite storage

✅ Event replay

---

## Non Goals

❌ MCP Server

❌ Mobile app

❌ Cloud sync

❌ User accounts

❌ AI analytics

Those belong to future versions.

---

# Architecture

```
Claude Code Hooks
        │
        ▼
 Event Protocol
        │
        ▼
 Session Manager
        │
        ├──────── Overlay
        │
        ├──────── Notification Engine
        │
        └──────── Event Store
                    │
               SQLite Database
```

The overlay continues using in-memory state.

Every incoming event is also persisted.

---

# Core Components

## 1. SQLite Event Store

Introduce a storage layer responsible for persisting all sessions.

Responsibilities:

- database initialization
- migrations
- async writes
- queries
- search
- statistics

The rest of the application should never execute SQL directly.

Instead expose:

```rust
trait SessionStore {
    fn create_session(...);

    fn append_event(...);

    fn complete_session(...);

    fn list_sessions(...);

    fn get_session(...);

    fn search(...);

    fn statistics(...);
}
```

---

## 2. Session Manager

Current SessionManager remains.

New responsibility:

Whenever a hook event arrives:

```
Update live session

↓

Persist event

↓

Notify overlay
```

The overlay should not know whether history exists.

---

## 3. Event Replay

Given a session:

```
Session Started

↓

Read Files

↓

Editing

↓

Testing

↓

Permission

↓

Completed
```

The SessionManager should be able to reconstruct session state purely from events.

This guarantees consistency.

---

# Database Schema

## sessions

```sql
id

project_id

started_at

ended_at

duration_ms

status

model

working_directory

branch

commit_hash

created_at
```

---

## events

```sql
id

session_id

timestamp

event_type

title

description

metadata_json
```

---

## projects

```sql
id

name

path

last_opened

first_seen

total_sessions

total_duration
```

---

## touched_files

```sql
id

session_id

path

operation

timestamp
```

---

# Event Types

Current protocol remains.

Persist:

```
SessionStarted

ActivityChanged

FileOpened

FileEdited

FileCreated

FileDeleted

TestingStarted

TestingFinished

PermissionRequested

PermissionResolved

Error

Completed

SessionEnded
```

Metadata remains JSON for future compatibility.

---

# Search

Support searching by:

- project
- filename
- activity
- model
- branch
- date
- duration

Examples

```
overlay.rs

tests

permission

agentpeek

yesterday

today

last week
```

---

# Timeline

Every session should expose:

```
09:14

Started

↓

09:16

Reading overlay.rs

↓

09:18

Editing overlay.rs

↓

09:26

Running Tests

↓

09:31

Completed
```

Timeline is reconstructed from events.

---

# Projects

Automatically group sessions.

Example

```
AgentPeek

42 Sessions

18h 14m

Last Opened Today
```

```
Camera App

12 Sessions

6h 32m
```

---

# Statistics

Per project:

- total sessions
- total coding time
- average session duration
- last active
- completion rate

Global:

- sessions today
- sessions this week
- total coding time
- permissions requested
- completed sessions

---

# History Window

Introduce a dedicated desktop window.

Current

```
Overlay
```

New

```
History
```

Layout

```
Sidebar

Today

Yesterday

This Week

Projects

Settings
```

Main panel

```
Completed

Overlay redesign

42 minutes

Timeline

Files

Metadata
```

---

# Session Details

Display

Project

Duration

Timeline

Files touched

Branch

Model

Working directory

Status

Completion time

---

# Global Search

Keyboard shortcut

```
⌘K
```

Search should instantly filter:

Projects

Sessions

Files

Activities

---

# Notifications

When a notification is clicked

Instead of disappearing forever

Open

```
Session Details
```

for that completed session.

---

# Performance

Requirements

- Overlay FPS unchanged
- Database writes async
- Zero dropped events
- Startup under 100ms
- Search under 50ms
- Database safe against crashes

---

# Storage

SQLite

Enable WAL mode.

Use prepared statements.

Indexes

```
session_id

project_id

timestamp

event_type

path
```

---

# Migrations

Version database schema.

Future upgrades should never lose user history.

Migration system should support:

```
v1

↓

v2

↓

v3
```

---

# Settings

History retention

Options

```
30 days

90 days

Forever
```

Buttons

```
Export Database

Import Database

Clear History
```

---

# Public Interfaces

Storage

```rust
SessionStore
```

Search

```rust
SearchService
```

Statistics

```rust
StatisticsService
```

Timeline

```rust
TimelineService
```

Avoid exposing SQL anywhere outside the storage layer.

---

# Testing

Unit Tests

- session creation
- event persistence
- replay correctness
- migration tests
- search queries

Integration Tests

- full session lifecycle
- crash recovery
- database upgrade
- history loading

---

# Success Criteria

By the end of v0.2 users should be able to:

- View every previous Claude session
- Search past work
- Inspect detailed timelines
- Browse projects
- See coding statistics
- Restart AgentPeek without losing history

while keeping the existing overlay experience completely unchanged.

---

# Future Compatibility

The following features should require **no database redesign**:

- MCP Server
- HTTP API
- Web Dashboard
- Mobile Companion
- Analytics
- Multi-agent support (Codex, Gemini CLI, Aider)

The storage layer should already expose a clean API so future services consume `SessionStore` rather than querying SQLite directly.

---

# Deferred to v0.3

- MCP Server
- Overlay remote control
- AI-generated session summaries
- Productivity insights
- Cross-project analytics
- HTTP/WebSocket API
- Multi-agent adapters

v0.2 is solely about **building the permanent memory layer** that every future AgentPeek feature will depend on.
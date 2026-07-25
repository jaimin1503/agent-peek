#!/usr/bin/env node
// AgentPeek — publishes Claude Code session state for the overlay to read.
//
// Runs on every lifecycle hook. Reads the hook payload from stdin, merges it
// into ~/.agentpeek/sessions/<session_id>.json, and exits. Never blocks and
// never fails loudly: a broken hook here would degrade every Claude session on
// the machine, so all work is wrapped and the exit code is always 0.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(os.homedir(), '.agentpeek');
const SESSIONS = path.join(ROOT, 'sessions');

// Claude session ids are UUIDs. Anything else is rejected rather than
// sanitized, so a malformed payload can never steer a write out of SESSIONS.
const SESSION_ID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// The list doubles as the dedupe set behind the "N files" statistic, so it is
// capped generously rather than at display length; the UI slices it.
// ponytail: a session touching >200 distinct files under-reports the count.
const MAX_FILES = 200;
const MAX_EVENTS = 50;
const TOKEN_REFRESH_MS = 10_000;
const FAILURES_BEFORE_ERROR = 3;

// Commands that mean "running the test suite" rather than any other shell work.
const TEST_COMMAND =
  /\b(jest|vitest|pytest|mocha|rspec|phpunit|ctest)\b|\b(cargo|go|dotnet|swift)\s+test\b|\b(npm|pnpm|yarn|bun)\s+(run\s+)?tests?\b|\btest:/i;

// TERM_PROGRAM values -> the app name `open -a` expects.
const TERMINAL_APPS = {
  vscode: 'Visual Studio Code',
  'iTerm.app': 'iTerm',
  Apple_Terminal: 'Terminal',
  Hyper: 'Hyper',
  WezTerm: 'WezTerm',
  ghostty: 'Ghostty',
  Warp: 'Warp',
};

function truncate(s, n) {
  s = String(s).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/** Human-readable "what is it doing right now" from a tool call. */
function describeTool(toolName, input) {
  const i = input || {};
  switch (toolName) {
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
      return i.file_path ? path.basename(i.file_path) : toolName;
    case 'Bash': {
      if (!i.command) return 'Running command';
      // Drop leading environment assignments: "PATH=... pnpm build" is really
      // just "pnpm build", and the prefix would eat the whole line.
      const command = String(i.command).replace(
        /^(\s*[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+)+/,
        ''
      );
      return truncate(command || i.command, 40);
    }
    case 'Grep':
    case 'Glob':
      return i.pattern ? truncate(i.pattern, 40) : toolName;
    case 'Task':
    case 'Agent':
      return i.description ? truncate(i.description, 40) : 'Subagent';
    case 'WebFetch':
    case 'WebSearch':
      return truncate(i.url || i.query || toolName, 40);
    default:
      return toolName || 'Working';
  }
}

/**
 * The kind of work an event represents. This is the only place activity is
 * classified — the overlay derives the orb, the timeline icon and the accent
 * colour from it rather than re-deriving any of that from tool names.
 *
 * @returns {'start'|'think'|'read'|'edit'|'run'|'test'|'wait'|'done'|'error'}
 */
function classifyKind(event, toolName, input) {
  switch (event) {
    case 'SessionStart':
      return 'start';
    case 'UserPromptSubmit':
      return 'think';
    case 'Notification':
      return 'wait';
    case 'Stop':
      return 'done';
  }
  switch (toolName) {
    case 'Read':
    case 'Grep':
    case 'Glob':
    case 'WebFetch':
    case 'WebSearch':
      return 'read';
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
      return 'edit';
    case 'Task':
    case 'Agent':
      return 'think';
    case 'Bash':
      return TEST_COMMAND.test((input && input.command) || '') ? 'test' : 'run';
    default:
      return 'run';
  }
}

/** Files an edit actually touched, for the "recently modified" list. */
function editedFile(toolName, input) {
  if (toolName !== 'Edit' && toolName !== 'Write' && toolName !== 'NotebookEdit') return null;
  return input && input.file_path ? path.basename(input.file_path) : null;
}

/**
 * Context usage from the transcript's most recent assistant turn.
 * Only the tail is read — these files grow into the megabytes and this runs
 * inside a hook that must stay fast.
 */
function readTokens(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return null;
  const size = fs.statSync(transcriptPath).size;
  if (!size) return null;

  const len = Math.min(size, 64 * 1024);
  const buf = Buffer.alloc(len);
  const fd = fs.openSync(transcriptPath, 'r');
  try {
    fs.readSync(fd, buf, 0, len, size - len);
  } finally {
    fs.closeSync(fd);
  }

  const lines = buf.toString('utf8').split('\n');
  for (let n = lines.length - 1; n >= 0; n--) {
    let entry;
    try {
      entry = JSON.parse(lines[n]);
    } catch {
      continue; // first line is usually a partial record — expected
    }
    const usage = entry && entry.type === 'assistant' && entry.message && entry.message.usage;
    if (!usage) continue;

    const used =
      (usage.input_tokens || 0) +
      (usage.cache_read_input_tokens || 0) +
      (usage.cache_creation_input_tokens || 0) +
      (usage.output_tokens || 0);
    const model = (entry.message.model || '') + '';
    // The transcript does not always carry the context-window suffix — a 1M
    // session can record a plain "claude-opus-5" — so the model string alone
    // reports 485k/200k as 243%. Usage above the assumed window is itself proof
    // the window is the larger one.
    // ponytail: two buckets cover every shipping model; widen if a third appears.
    const max = /\[1m\]|-1m\b/.test(model) || used > 200_000 ? 1_000_000 : 200_000;
    return { used, max };
  }
  return null;
}

/** A tool result that represents a real failure, not an empty search. */
function toolFailed(response) {
  if (!response) return false;
  if (typeof response === 'string') return /^error:/i.test(response.trim());
  if (typeof response !== 'object') return false;
  if (response.is_error === true || response.isError === true) return true;
  return typeof response.error === 'string' && response.error.length > 0;
}

function load(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * tmp + rename. The overlay watches this directory, so a partial file would be
 * read as truncated JSON; rename is atomic and never exposes one.
 */
function save(file, state) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, file);
}

function main() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => (raw += chunk));
  process.stdin.on('end', () => {
    try {
      apply(JSON.parse(raw));
    } catch {
      // Deliberately silent — see file header.
    }
    process.exit(0);
  });
}

function apply(payload) {
  const id = payload && payload.session_id;
  if (!SESSION_ID.test(String(id || ''))) return;

  const event = payload.hook_event_name;
  const file = path.join(SESSIONS, id + '.json');

  if (event === 'SessionEnd') {
    try {
      fs.unlinkSync(file);
    } catch {
      /* already gone */
    }
    return;
  }

  fs.mkdirSync(SESSIONS, { recursive: true });

  const now = Date.now();
  const state = load(file) || {
    agent: 'claude',
    sessionId: id,
    cwd: payload.cwd || '',
    status: 'idle',
    message: 'Starting',
    startedAt: now,
    updatedAt: now,
    filesTouched: [],
    failureStreak: 0,
    events: [],
  };

  state.cwd = payload.cwd || state.cwd;
  state.updatedAt = now;
  if (process.env.TERM_PROGRAM) {
    state.terminalApp = TERMINAL_APPS[process.env.TERM_PROGRAM] || null;
  }

  // What, if anything, this invocation contributes to the timeline. PostToolUse
  // deliberately records nothing unless it flips the session into error —
  // otherwise every tool call would appear twice.
  let record = null;

  switch (event) {
    case 'SessionStart':
      state.status = 'idle';
      state.message = 'Session started';
      state.startedAt = now;
      record = { kind: 'start', label: 'Session started' };
      break;

    case 'UserPromptSubmit':
      state.status = 'working';
      state.message = 'Thinking';
      state.failureStreak = 0;
      record = { kind: 'think', label: 'Thinking' };
      break;

    case 'PreToolUse':
      state.status = 'working';
      state.toolName = payload.tool_name;
      state.message = describeTool(payload.tool_name, payload.tool_input);
      record = {
        kind: classifyKind(event, payload.tool_name, payload.tool_input),
        label: state.message,
      };
      break;

    case 'PostToolUse': {
      const touched = editedFile(payload.tool_name, payload.tool_input);
      if (touched) {
        state.filesTouched = [touched, ...(state.filesTouched || []).filter((f) => f !== touched)].slice(
          0,
          MAX_FILES
        );
      }
      // A single failed tool call is normal mid-task (a failing test, an empty
      // grep). A streak means the agent is stuck, which is worth surfacing.
      state.failureStreak = toolFailed(payload.tool_response) ? (state.failureStreak || 0) + 1 : 0;
      if (state.failureStreak >= FAILURES_BEFORE_ERROR) {
        state.status = 'error';
        state.message = `${state.failureStreak} tool failures in a row`;
        record = { kind: 'error', label: state.message };
      }
      break;
    }

    case 'Notification': {
      const msg = String(payload.message || 'Needs attention');
      state.status = /permission|approve|allow/i.test(msg) ? 'permission' : 'question';
      state.message = truncate(msg, 80);
      record = { kind: 'wait', label: state.message };
      // Collected during bring-up so the match above can be tightened against
      // the real strings rather than guessed at.
      try {
        fs.appendFileSync(path.join(ROOT, 'notification-samples.log'), msg + '\n');
      } catch {
        /* best effort */
      }
      break;
    }

    case 'Stop':
      state.status = 'completed';
      state.message = 'Finished';
      state.toolName = undefined;
      state.failureStreak = 0;
      record = { kind: 'done', label: 'Finished' };
      break;

    default:
      return;
  }

  // Append-only history. Everything the overlay shows is derived from the
  // materialised fields above, but this is the canonical record of what
  // happened — kept for the timeline, and for replay or analysis later.
  if (record) {
    state.events = [...(state.events || []), { t: now, event, ...record }].slice(-MAX_EVENTS);
  }

  // Tailing the transcript on every tool call is wasted I/O; refresh on the
  // events that matter and throttle the rest.
  const stale = !state.tokensAt || now - state.tokensAt > TOKEN_REFRESH_MS;
  if (event === 'Stop' || event === 'Notification' || stale) {
    try {
      const tokens = readTokens(payload.transcript_path);
      if (tokens) {
        state.tokens = tokens;
        state.tokensAt = now;
      }
    } catch {
      /* token display is optional */
    }
  }

  save(file, state);
}

if (require.main === module) main();

module.exports = {
  describeTool,
  classifyKind,
  editedFile,
  toolFailed,
  readTokens,
  apply,
  SESSION_ID,
  SESSIONS,
  ROOT,
  MAX_EVENTS,
};

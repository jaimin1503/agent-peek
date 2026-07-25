#!/usr/bin/env node
// Run: node plugin/hooks/test-hook.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const h = require('./agentpeek-hook.cjs');

const ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const FILE = path.join(h.SESSIONS, ID + '.json');
const read = () => JSON.parse(fs.readFileSync(FILE, 'utf8'));
const cleanup = () => fs.rmSync(FILE, { force: true });

cleanup();

// --- describeTool -----------------------------------------------------------
assert.equal(h.describeTool('Edit', { file_path: '/a/b/ColorProcessor.kt' }), 'ColorProcessor.kt');
assert.equal(h.describeTool('Bash', { command: 'npm test' }), 'npm test');
assert.equal(
  h.describeTool('Bash', { command: 'PATH="$HOME/.cargo/bin:$PATH" pnpm build' }),
  'pnpm build',
  'leading env assignments are stripped — they would otherwise eat the whole line'
);
assert.equal(h.describeTool('Bash', { command: 'FOO=1 BAR=2 ls -la' }), 'ls -la');
assert.equal(h.describeTool('Bash', { command: 'a=1' }), 'a=1', 'a bare assignment is still the command');
assert.equal(h.describeTool('Bash', { command: 'x'.repeat(80) }).length, 40, 'long commands truncate to 40');
assert.equal(h.describeTool('Grep', { pattern: 'TODO' }), 'TODO');
assert.equal(h.describeTool('Task', { description: 'audit deps' }), 'audit deps');
assert.equal(h.describeTool('SomeFutureTool', {}), 'SomeFutureTool', 'unknown tools fall through to the name');
assert.equal(h.describeTool('Edit', {}), 'Edit', 'missing file_path must not throw');

// --- editedFile -------------------------------------------------------------
assert.equal(h.editedFile('Write', { file_path: '/a/Foo.ts' }), 'Foo.ts');
assert.equal(h.editedFile('Read', { file_path: '/a/Foo.ts' }), null, 'reads are not edits');

// --- toolFailed -------------------------------------------------------------
assert.equal(h.toolFailed({ is_error: true }), true);
assert.equal(h.toolFailed({ error: 'boom' }), true);
assert.equal(h.toolFailed('Error: nope'), true);
assert.equal(h.toolFailed({ stdout: 'ok' }), false);
assert.equal(h.toolFailed('No matches found'), false, 'an empty search is not a failure');
assert.equal(h.toolFailed(undefined), false);

// --- session_id is rejected, never sanitized --------------------------------
for (const bad of ['../../evil', 'evil', '', null, '../' + ID, ID + '/../x']) {
  h.apply({ hook_event_name: 'SessionStart', session_id: bad, cwd: '/tmp' });
}
const strays = fs.existsSync(h.ROOT) ? fs.readdirSync(h.ROOT).filter((f) => /evil/.test(f)) : [];
assert.deepEqual(strays, [], 'no file may be written outside sessions/');
assert.ok(!fs.existsSync(path.join(os.homedir(), 'evil')), 'no traversal out of ~/.agentpeek');

// --- status transitions -----------------------------------------------------
h.apply({ hook_event_name: 'SessionStart', session_id: ID, cwd: '/tmp/proj' });
assert.equal(read().status, 'idle');
assert.equal(read().cwd, '/tmp/proj');

h.apply({ hook_event_name: 'PreToolUse', session_id: ID, tool_name: 'Edit', tool_input: { file_path: '/p/Foo.kt' } });
assert.equal(read().status, 'working');
assert.equal(read().message, 'Foo.kt');

h.apply({ hook_event_name: 'PostToolUse', session_id: ID, tool_name: 'Edit', tool_input: { file_path: '/p/Foo.kt' }, tool_response: {} });
assert.deepEqual(read().filesTouched, ['Foo.kt']);

// same file twice stays one entry, and jumps back to the front
h.apply({ hook_event_name: 'PostToolUse', session_id: ID, tool_name: 'Write', tool_input: { file_path: '/p/Bar.kt' }, tool_response: {} });
h.apply({ hook_event_name: 'PostToolUse', session_id: ID, tool_name: 'Edit', tool_input: { file_path: '/p/Foo.kt' }, tool_response: {} });
assert.deepEqual(read().filesTouched, ['Foo.kt', 'Bar.kt']);

// the list doubles as the dedupe set behind the "N files" stat, so it holds
// far more than it displays
for (let n = 0; n < 30; n++) {
  h.apply({ hook_event_name: 'PostToolUse', session_id: ID, tool_name: 'Write', tool_input: { file_path: `/p/f${n}.ts` }, tool_response: {} });
}
assert.equal(read().filesTouched.length, 32, '30 new files plus Foo.kt and Bar.kt, all distinct');

// --- failure streak ---------------------------------------------------------
const fail = () => h.apply({ hook_event_name: 'PostToolUse', session_id: ID, tool_name: 'Bash', tool_input: {}, tool_response: { is_error: true } });
fail();
assert.notEqual(read().status, 'error', 'one failure is normal');
fail();
assert.notEqual(read().status, 'error', 'two failures are still normal');
fail();
assert.equal(read().status, 'error', 'three in a row means stuck');

h.apply({ hook_event_name: 'PostToolUse', session_id: ID, tool_name: 'Bash', tool_input: {}, tool_response: { stdout: 'ok' } });
assert.equal(read().failureStreak, 0, 'one success resets the streak');

// --- attention states -------------------------------------------------------
h.apply({ hook_event_name: 'Notification', session_id: ID, message: 'Claude needs your permission to use Bash' });
assert.equal(read().status, 'permission');

h.apply({ hook_event_name: 'Notification', session_id: ID, message: 'Claude is waiting for your input' });
assert.equal(read().status, 'question');

h.apply({ hook_event_name: 'Stop', session_id: ID });
assert.equal(read().status, 'completed');
assert.equal(read().message, 'Finished');

// --- event kind classification ----------------------------------------------
assert.equal(h.classifyKind('SessionStart'), 'start');
assert.equal(h.classifyKind('UserPromptSubmit'), 'think');
assert.equal(h.classifyKind('Notification'), 'wait');
assert.equal(h.classifyKind('Stop'), 'done');
assert.equal(h.classifyKind('PreToolUse', 'Read', {}), 'read');
assert.equal(h.classifyKind('PreToolUse', 'Grep', {}), 'read');
assert.equal(h.classifyKind('PreToolUse', 'Edit', {}), 'edit');
assert.equal(h.classifyKind('PreToolUse', 'Write', {}), 'edit');
assert.equal(h.classifyKind('PreToolUse', 'Task', {}), 'think');
assert.equal(h.classifyKind('PreToolUse', 'SomeFutureTool', {}), 'run', 'unknown tools are plain work');

// a test run is not just any shell command
for (const cmd of ['npm test', 'pnpm run test', 'cargo test', 'go test ./...', 'npx vitest run', 'pytest -q']) {
  assert.equal(h.classifyKind('PreToolUse', 'Bash', { command: cmd }), 'test', `"${cmd}" is a test run`);
}
for (const cmd of ['npm run build', 'git status', 'ls -la', 'echo latest']) {
  assert.equal(h.classifyKind('PreToolUse', 'Bash', { command: cmd }), 'run', `"${cmd}" is not a test run`);
}

// --- event log --------------------------------------------------------------
cleanup();
h.apply({ hook_event_name: 'SessionStart', session_id: ID, cwd: '/tmp/p' });
h.apply({ hook_event_name: 'UserPromptSubmit', session_id: ID });
h.apply({ hook_event_name: 'PreToolUse', session_id: ID, tool_name: 'Read', tool_input: { file_path: '/p/A.ts' } });
h.apply({ hook_event_name: 'PreToolUse', session_id: ID, tool_name: 'Edit', tool_input: { file_path: '/p/B.ts' } });
h.apply({ hook_event_name: 'PreToolUse', session_id: ID, tool_name: 'Bash', tool_input: { command: 'npm test' } });

assert.deepEqual(
  read().events.map((e) => e.kind),
  ['start', 'think', 'read', 'edit', 'test'],
  'events append in order, one per tool call'
);
assert.deepEqual(read().events.map((e) => e.label), [
  'Session started', 'Thinking', 'A.ts', 'B.ts', 'npm test',
]);
assert.ok(read().events.every((e) => typeof e.t === 'number'), 'every event is timestamped');

// PostToolUse must not double-record the tool call that PreToolUse already logged
const before = read().events.length;
h.apply({ hook_event_name: 'PostToolUse', session_id: ID, tool_name: 'Edit', tool_input: { file_path: '/p/B.ts' }, tool_response: {} });
assert.equal(read().events.length, before, 'PostToolUse adds no timeline entry on success');

// ...but a failure streak is worth recording
for (let n = 0; n < 3; n++) {
  h.apply({ hook_event_name: 'PostToolUse', session_id: ID, tool_name: 'Bash', tool_input: {}, tool_response: { is_error: true } });
}
assert.equal(read().events.at(-1).kind, 'error', 'the streak that flips status also lands in the timeline');

// oldest events fall off the end, newest survive
for (let n = 0; n < h.MAX_EVENTS + 20; n++) {
  h.apply({ hook_event_name: 'PreToolUse', session_id: ID, tool_name: 'Read', tool_input: { file_path: `/p/x${n}.ts` } });
}
assert.equal(read().events.length, h.MAX_EVENTS, `capped at ${h.MAX_EVENTS}`);
assert.equal(read().events.at(-1).label, `x${h.MAX_EVENTS + 19}.ts`, 'the newest event is kept');
cleanup();

// --- tokens -----------------------------------------------------------------
const transcript = path.join(os.tmpdir(), 'agentpeek-test-transcript.jsonl');
fs.writeFileSync(
  transcript,
  [
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }),
    JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-5', usage: { input_tokens: 1, cache_read_input_tokens: 10, cache_creation_input_tokens: 100, output_tokens: 1000 } } }),
  ].join('\n') + '\n'
);
assert.deepEqual(h.readTokens(transcript), { used: 1111, max: 200_000 });

fs.appendFileSync(transcript, JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-5[1m]', usage: { output_tokens: 5 } } }) + '\n');
assert.deepEqual(h.readTokens(transcript), { used: 5, max: 1_000_000 }, 'the 1M variant reports the wider window');

// A 1M session can record a plain model id with no suffix, so usage above the
// smaller window is what proves which window it is. Without this the overlay
// showed "243% ctx".
fs.writeFileSync(
  transcript,
  JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-5', usage: { input_tokens: 485_000 } } }) + '\n'
);
assert.deepEqual(h.readTokens(transcript), { used: 485_000, max: 1_000_000 }, 'usage over 200k implies the wide window');

fs.writeFileSync(
  transcript,
  JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-5', usage: { input_tokens: 145_000 } } }) + '\n'
);
assert.deepEqual(h.readTokens(transcript), { used: 145_000, max: 200_000 }, 'usage under 200k stays on the narrow window');

assert.equal(h.readTokens('/nonexistent/path.jsonl'), null);
fs.rmSync(transcript, { force: true });

// --- SessionEnd removes the file -------------------------------------------
h.apply({ hook_event_name: 'SessionStart', session_id: ID, cwd: '/tmp/p' });
assert.ok(fs.existsSync(FILE), 'a session exists to be ended');
h.apply({ hook_event_name: 'SessionEnd', session_id: ID });
assert.ok(!fs.existsSync(FILE), 'SessionEnd clears the session');

cleanup();
console.log('ok — all hook tests passed');

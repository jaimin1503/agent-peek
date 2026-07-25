/**
 * The one shape the overlay understands. Every agent adapter writes this;
 * the UI never learns anything agent-specific.
 *
 * Kept in sync by hand with plugin/hooks/agentpeek-hook.cjs.
 */

export type Status = 'idle' | 'working' | 'permission' | 'question' | 'completed' | 'error';

/**
 * The kind of work an event represents, classified once in the hook. The orb,
 * the timeline icon and the accent colour all derive from this — nothing in the
 * UI re-inspects tool names.
 */
export type EventKind = 'start' | 'think' | 'read' | 'edit' | 'run' | 'test' | 'wait' | 'done' | 'error';

export interface AgentEvent {
  /** epoch ms */
  t: number;
  /** the hook that produced it, e.g. "PreToolUse" */
  event: string;
  kind: EventKind;
  /** "ColorProcessor.kt", "npm test" */
  label: string;
}

export interface SessionState {
  agent: 'claude';
  sessionId: string;
  /** Absolute project directory; the UI shows its basename. */
  cwd: string;
  status: Status;
  /** What it is doing right now — "ColorProcessor.kt", "npm test". */
  message: string;
  toolName?: string;
  startedAt: number;
  updatedAt: number;
  /** Distinct files edited. Doubles as the dedupe set behind the files stat. */
  filesTouched: string[];
  /** Append-only history, newest last, capped at 50 by the hook. */
  events?: AgentEvent[];
  tokens?: { used: number; max: number };
  /** macOS app name for `open -a`, or null when TERM_PROGRAM is unmapped. */
  terminalApp?: string | null;
}

/** Statuses that mean "stop what you're doing and come back". */
export const NEEDS_ATTENTION: Status[] = ['permission', 'question', 'error'];

/** Worst-first, so the tray icon and sort order agree on what matters. */
export const SEVERITY: Record<Status, number> = {
  error: 4,
  permission: 3,
  question: 3,
  completed: 2,
  working: 1,
  idle: 0,
};

export function needsAttention(s: SessionState): boolean {
  return NEEDS_ATTENTION.includes(s.status);
}

export function projectName(s: SessionState): string {
  return s.cwd.split('/').filter(Boolean).pop() || 'unknown';
}

/**
 * Distinct files edited this session. Derived rather than stored — the hook's
 * list is the dedupe set, so its length is already the answer.
 */
export function filesModified(s: SessionState): number {
  return s.filesTouched?.length ?? 0;
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

/**
 * Context usage as a whole percent, clamped.
 *
 * Clamped because the window size is inferred rather than reported: a session
 * whose usage outruns the assumed window would otherwise display something like
 * "243% ctx", which reads as a bug even when the token count is right.
 */
export function contextPct(tokens: { used: number; max: number }): number {
  return Math.max(0, Math.min(100, Math.round((tokens.used / tokens.max) * 100)));
}

/** "145k" — compact enough for a chip, exact enough to be useful. */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

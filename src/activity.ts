import type { AgentEvent, EventKind, SessionState, Status } from './protocol';

/**
 * What the orb is depicting. Distinct from `Status`: status answers "do I need
 * to go back?", activity answers "what is it doing right now?".
 */
export type Activity = 'idle' | 'thinking' | 'reading' | 'editing' | 'running' | 'testing' | 'waiting' | 'done' | 'error';

const FROM_KIND: Record<EventKind, Activity> = {
  start: 'idle',
  think: 'thinking',
  read: 'reading',
  edit: 'editing',
  run: 'running',
  test: 'testing',
  wait: 'waiting',
  done: 'done',
  error: 'error',
};

/** Status wins over the event log whenever it means "come back here". */
const FROM_STATUS: Partial<Record<Status, Activity>> = {
  permission: 'waiting',
  question: 'waiting',
  error: 'error',
  completed: 'done',
  idle: 'idle',
};

export function activityOf(s: SessionState): Activity {
  const forced = FROM_STATUS[s.status];
  if (forced) return forced;

  const last = s.events?.at(-1);
  if (last) return FROM_KIND[last.kind] ?? 'thinking';

  // A session from before the event log existed, or one mid-turn with no tool
  // call yet: "working" with nothing more specific to say is thinking.
  return s.status === 'working' ? 'thinking' : 'idle';
}

/** Verb shown next to the activity line — "Editing", "Running tests". */
export const ACTIVITY_VERB: Record<Activity, string> = {
  idle: 'Idle',
  thinking: 'Thinking',
  reading: 'Reading',
  editing: 'Editing',
  running: 'Running',
  testing: 'Testing',
  waiting: 'Waiting',
  done: 'Finished',
  error: 'Error',
};

/**
 * Collapse consecutive same-kind events into one line, so forty reads read as
 * "Read 42 files" rather than forty rows. Newest last.
 */
export interface TimelineEntry {
  id: string;
  kind: EventKind;
  label: string;
  count: number;
  t: number;
}

export function toTimeline(events: AgentEvent[] | undefined, limit = 4): TimelineEntry[] {
  if (!events?.length) return [];

  const grouped: TimelineEntry[] = [];
  for (const e of events) {
    const prev = grouped.at(-1);
    if (prev && prev.kind === e.kind) {
      prev.count += 1;
      prev.label = e.label; // the group shows whatever it is on now
      prev.t = e.t;
    } else {
      grouped.push({ id: `${e.t}-${e.kind}`, kind: e.kind, label: e.label, count: 1, t: e.t });
    }
  }
  return grouped.slice(-limit);
}

/** "Read 42 files" / "Editing Color.kt" — the collapsed group's caption. */
export function entryText(e: TimelineEntry): { verb: string; detail: string } {
  const plural = e.count > 1;
  switch (e.kind) {
    case 'read':
      return { verb: 'Read', detail: plural ? `${e.count} files` : e.label };
    case 'edit':
      return { verb: plural ? 'Edited' : 'Edited', detail: plural ? `${e.count} files` : e.label };
    // The label for both is the command itself, so the verb stays generic and
    // the icon carries the distinction — "Tested pnpm test" reads badly.
    case 'test':
    case 'run':
      return { verb: 'Ran', detail: e.label };
    case 'think':
      return { verb: 'Planned', detail: plural ? `${e.count} steps` : 'changes' };
    case 'wait':
      return { verb: 'Waiting', detail: e.label };
    case 'done':
      return { verb: 'Finished', detail: '' };
    case 'error':
      return { verb: 'Error', detail: e.label };
    case 'start':
      return { verb: 'Started', detail: '' };
  }
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { BaseDirectory, exists, readDir, readTextFile } from '@tauri-apps/plugin-fs';
import { SEVERITY, needsAttention, type SessionState } from './protocol';

export const LIVE_DIR = '.agentpeek/sessions';
/** Where the hook parks a session once it ends. Same JSON, read by the history window. */
export const HISTORY_DIR = '.agentpeek/history';

// ponytail: polled, not watched. tauri-plugin-fs puts watching behind a
// non-default cargo feature (notify + a debouncer); re-reading a handful of
// tiny JSON files once a second costs less than that dependency, and it
// re-evaluates staleness — which is time-based, not event-based — for free.
const POLL_MS = 1000;

/**
 * A session whose process was killed never fires SessionEnd, so its file would
 * sit in the directory forever. Anything this quiet is assumed dead — unless it
 * is waiting on you, which is exactly the state you must not silently drop.
 */
const STALE_MS = 10 * 60 * 1000;

/**
 * How long a finished session stays on screen after its file is gone.
 * `SessionEnd` deletes the file the moment Claude exits, so without this the
 * completed card — and its ripple — would vanish in the same frame it appeared.
 */
const COMPLETED_HOLD_MS = 15_000;

function isLive(s: SessionState, now: number): boolean {
  return needsAttention(s) || now - s.updatedAt < STALE_MS;
}

/**
 * Every session file in one directory. Shared with the history window, which
 * reads the same shape out of `history/` — the only difference between the two
 * directories is whether the session is still running.
 */
export async function readSessionDir(dir: string): Promise<SessionState[]> {
  if (!(await exists(dir, { baseDir: BaseDirectory.Home }))) return [];

  const entries = await readDir(dir, { baseDir: BaseDirectory.Home });
  const sessions = await Promise.all(
    entries
      .filter((e) => e.isFile && e.name.endsWith('.json'))
      .map(async (e) => {
        try {
          return JSON.parse(
            await readTextFile(`${dir}/${e.name}`, { baseDir: BaseDirectory.Home })
          ) as SessionState;
        } catch {
          // Deleted or mid-write. The next poll re-reads it.
          return null;
        }
      })
  );
  return sessions.filter(Boolean) as SessionState[];
}

async function readAll(): Promise<SessionState[]> {
  const now = Date.now();
  return (await readSessionDir(LIVE_DIR))
    .filter((s) => isLive(s, now))
    .sort((a, b) => SEVERITY[b.status] - SEVERITY[a.status] || b.updatedAt - a.updatedAt);
}

export interface Sessions {
  sessions: SessionState[];
  /** Stop showing this session for the rest of the run. */
  dismiss: (sessionId: string) => void;
}

export function useSessions(): Sessions {
  const [sessions, setSessions] = useState<SessionState[]>([]);
  /**
   * Sessions you have told the overlay to stop tracking. A ref, so dismissing
   * does not restart the poll loop, and deliberately not persisted — the ids are
   * per-run and a set that outlived them would only grow.
   */
  const dismissed = useRef(new Set<string>());

  const dismiss = useCallback((sessionId: string) => {
    dismissed.current.add(sessionId);
    // Drop it now rather than waiting up to a second for the next poll.
    setSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
  }, []);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    /** Finished sessions whose files are gone but whose card is still showing. */
    const holding = new Map<string, { session: SessionState; until: number }>();

    // Chained rather than setInterval: a slow read can never stack up behind
    // itself, and one failed poll does not kill the loop.
    const tick = async () => {
      try {
        // Filtered before anything else sees them, and before `holding` is
        // updated, so a dismissed session cannot come back through the 15s
        // completed-hold. Doing it here rather than at the render site is what
        // makes "stop tracking" also silence its notifications and drop it from
        // the tray count — App.tsx feeds this same array to both.
        const found = (await readAll()).filter((s) => !dismissed.current.has(s.sessionId));
        const now = Date.now();

        for (const s of found) {
          if (s.status === 'completed') {
            holding.set(s.sessionId, { session: s, until: now + COMPLETED_HOLD_MS });
          }
        }

        const live = new Set(found.map((s) => s.sessionId));
        const revived: SessionState[] = [];
        for (const [id, held] of holding) {
          if (now > held.until) holding.delete(id);
          else if (!live.has(id)) revived.push(held.session);
        }

        const next = [...found, ...revived].sort(
          (a, b) => SEVERITY[b.status] - SEVERITY[a.status] || b.updatedAt - a.updatedAt
        );
        if (alive) setSessions(next);
      } catch {
        /* transient — try again next tick */
      }
      if (alive) timer = setTimeout(tick, POLL_MS);
    };
    tick();

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  return { sessions, dismiss };
}

import { useEffect, useState } from 'react';
import { BaseDirectory, exists, readDir, readTextFile } from '@tauri-apps/plugin-fs';
import { SEVERITY, needsAttention, type SessionState } from './protocol';

const DIR = '.agentpeek/sessions';

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

async function readAll(): Promise<SessionState[]> {
  if (!(await exists(DIR, { baseDir: BaseDirectory.Home }))) return [];

  const entries = await readDir(DIR, { baseDir: BaseDirectory.Home });
  const sessions = await Promise.all(
    entries
      .filter((e) => e.isFile && e.name.endsWith('.json'))
      .map(async (e) => {
        try {
          return JSON.parse(
            await readTextFile(`${DIR}/${e.name}`, { baseDir: BaseDirectory.Home })
          ) as SessionState;
        } catch {
          // Deleted or mid-write. The next poll re-reads it.
          return null;
        }
      })
  );

  const now = Date.now();
  return (sessions.filter(Boolean) as SessionState[])
    .filter((s) => isLive(s, now))
    .sort((a, b) => SEVERITY[b.status] - SEVERITY[a.status] || b.updatedAt - a.updatedAt);
}

export function useSessions(): SessionState[] {
  const [sessions, setSessions] = useState<SessionState[]>([]);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    /** Finished sessions whose files are gone but whose card is still showing. */
    const holding = new Map<string, { session: SessionState; until: number }>();

    // Chained rather than setInterval: a slow read can never stack up behind
    // itself, and one failed poll does not kill the loop.
    const tick = async () => {
      try {
        const found = await readAll();
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

  return sessions;
}

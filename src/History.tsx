/**
 * The history window: every session the hook has ever archived.
 *
 * ponytail: no database. `~/.agentpeek/history/*.json` is already the
 * event-sourced record the overlay reads, one file per session, so history is a
 * directory read plus `.filter()` and `.reduce()` — search, projects and stats
 * are all derived here rather than queried. Known ceiling: every session is
 * loaded into memory on open, which is fine for thousands of ~5KB files and
 * stops being fine somewhere in the tens of thousands. That is when SQLite (and
 * a paged list) earns its place, not before.
 *
 * This window is otherwise unrelated to the overlay — separate HTML entry,
 * separate root, no `overlay.rs` involvement. It is an ordinary window.
 */

import { useEffect, useMemo, useState } from 'react';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { Timeline } from './Timeline';
import { HISTORY_DIR, LIVE_DIR, readSessionDir } from './useSessions';
import {
  contextPct,
  durationOf,
  formatElapsed,
  formatTokens,
  projectName,
  type SessionState,
  type Status,
} from './protocol';
import './App.css';
import './History.css';

const DAY = 24 * 60 * 60 * 1000;

type Range = 'today' | 'yesterday' | 'week' | 'all';

const RANGE_LABEL: Record<Range, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'This Week',
  all: 'Everything',
};

const STATUS_TONE: Record<Status, string> = {
  completed: 'text-emerald-400/80',
  error: 'text-red-400/80',
  permission: 'text-amber-400/80',
  question: 'text-amber-400/80',
  working: 'text-sky-400/80',
  idle: 'text-white/35',
};

/** Midnight, local. Every range is measured from here. */
function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function inRange(s: SessionState, range: Range, today: number): boolean {
  switch (range) {
    case 'today':
      return s.startedAt >= today;
    case 'yesterday':
      return s.startedAt >= today - DAY && s.startedAt < today;
    case 'week':
      // Today plus the six days before it — a rolling week, not an ISO one.
      return s.startedAt >= today - 6 * DAY;
    case 'all':
      return true;
  }
}

/**
 * Every term must appear somewhere in the session. Terms are ANDed so "overlay
 * error" narrows rather than widens, and the haystack is everything the session
 * knows about itself — project, path, status, files, and every timeline label.
 */
function matches(s: SessionState, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;

  const haystack = [
    projectName(s),
    s.cwd,
    s.status,
    s.message,
    s.model ?? '',
    ...(s.filesTouched ?? []),
    ...(s.events ?? []).map((e) => `${e.kind} ${e.label}`),
  ]
    .join(' ')
    .toLowerCase();

  return terms.every((t) => haystack.includes(t));
}

interface Project {
  name: string;
  count: number;
  total: number;
  last: number;
}

function byProject(sessions: SessionState[]): Project[] {
  const projects = new Map<string, Project>();
  for (const s of sessions) {
    const name = projectName(s);
    const p = projects.get(name) ?? { name, count: 0, total: 0, last: 0 };
    p.count += 1;
    p.total += durationOf(s);
    p.last = Math.max(p.last, s.updatedAt);
    projects.set(name, p);
  }
  return [...projects.values()].sort((a, b) => b.last - a.last);
}

function summarise(sessions: SessionState[]) {
  const total = sessions.reduce((ms, s) => ms + durationOf(s), 0);
  const completed = sessions.filter((s) => s.status === 'completed').length;
  const waited = sessions.filter((s) => (s.events ?? []).some((e) => e.kind === 'wait')).length;
  return {
    count: sessions.length,
    total,
    average: sessions.length ? total / sessions.length : 0,
    completion: sessions.length ? Math.round((completed / sessions.length) * 100) : 0,
    waited,
  };
}

const DATE = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const TIME = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });

/** "today 14:02" for anything recent, "Mar 4 14:02" once it is not. */
function when(t: number, today: number): string {
  const time = TIME.format(t);
  if (t >= today) return `today ${time}`;
  if (t >= today - DAY) return `yesterday ${time}`;
  return `${DATE.format(t)} ${time}`;
}

/**
 * History and live sessions, newest first. Read on open and whenever the window
 * comes back to the front — nothing else can change it, since a session only
 * lands in `history/` when it ends.
 */
function useHistory(): SessionState[] {
  const [sessions, setSessions] = useState<SessionState[]>([]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [past, live] = await Promise.all([
          readSessionDir(HISTORY_DIR),
          readSessionDir(LIVE_DIR),
        ]);
        // A session is briefly in both directories while it is being archived.
        // The archived copy is the finished one, so it wins.
        const merged = new Map(live.map((s) => [s.sessionId, s]));
        for (const s of past) merged.set(s.sessionId, s);
        if (alive) setSessions([...merged.values()].sort((a, b) => b.startedAt - a.startedAt));
      } catch {
        /* nothing to show */
      }
    };

    // Both, because the window is shown and hidden rather than created and
    // closed: `focus` covers being clicked back into, `visibilitychange` covers
    // being ordered in from the tray after sitting hidden since launch.
    const refresh = () => {
      if (!document.hidden) void load();
    };
    load();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      alive = false;
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  return sessions;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline text-[11px] leading-[17px]">
      <span className="shrink-0 text-white/35">{label}</span>
      <span className="leader" />
      <span className="min-w-0 truncate text-white/70">{value}</span>
    </div>
  );
}

function Detail({ session, today }: { session: SessionState; today: number }) {
  const files = session.filesTouched ?? [];

  return (
    <div className="grid gap-5 border-t border-white/6 bg-black/25 px-4 py-3.5 md:grid-cols-2">
      <div className="min-w-0">
        <p className="mb-2 text-[10px] tracking-wide text-white/30 uppercase">Timeline</p>
        {/* Infinity, not the overlay's tail: this is the whole session — capped
            at MAX_EVENTS by the hook, so it is the last 50 events. */}
        <Timeline events={session.events} limit={Infinity} time />
        {!session.events?.length && <p className="text-[11px] text-white/30">nothing recorded</p>}
      </div>

      <div className="min-w-0">
        <p className="mb-2 text-[10px] tracking-wide text-white/30 uppercase">Session</p>
        <Row label="started" value={when(session.startedAt, today)} />
        <Row
          label={session.endedAt ? 'ended' : 'last seen'}
          value={when(session.endedAt ?? session.updatedAt, today)}
        />
        <Row label="duration" value={formatElapsed(durationOf(session))} />
        <Row label="status" value={session.status} />
        {session.model && <Row label="model" value={session.model} />}
        {session.tokens && (
          <Row
            label="context"
            value={`${formatTokens(session.tokens.used)} / ${contextPct(session.tokens)}%`}
          />
        )}
        <Row label="directory" value={session.cwd || 'unknown'} />
        <Row label="id" value={session.sessionId} />

        {files.length > 0 && (
          <>
            <p className="mt-4 mb-2 text-[10px] tracking-wide text-white/30 uppercase">
              Files touched ({files.length})
            </p>
            <div className="flex flex-wrap gap-1.5">
              {files.map((f) => (
                <span
                  key={f}
                  className="rounded border border-white/8 bg-white/4 px-1.5 py-[2px] text-[10.5px] leading-none text-white/60"
                >
                  {f}
                </span>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SessionRow({
  session,
  today,
  open,
  onToggle,
}: {
  session: SessionState;
  today: number;
  open: boolean;
  onToggle: () => void;
}) {
  const files = session.filesTouched?.length ?? 0;

  return (
    <li className="border-b border-white/6">
      <button
        onClick={onToggle}
        className="flex w-full items-baseline gap-2.5 px-4 py-2.5 text-left text-[11px] leading-none transition-colors hover:bg-white/4"
      >
        <span className={`w-[9px] shrink-0 ${STATUS_TONE[session.status]}`}>{open ? '▾' : '▸'}</span>
        <span className="w-[130px] shrink-0 truncate font-medium text-white/85">
          {projectName(session)}
        </span>
        <span className={`w-[70px] shrink-0 ${STATUS_TONE[session.status]}`}>{session.status}</span>
        <span className="min-w-0 flex-1 truncate text-white/45">{session.message}</span>
        {files > 0 && <span className="shrink-0 text-white/30">{files}f</span>}
        <span className="w-[54px] shrink-0 text-right tabular-nums text-white/45">
          {formatElapsed(durationOf(session))}
        </span>
        <span className="w-[112px] shrink-0 text-right whitespace-nowrap tabular-nums text-white/30">
          {when(session.startedAt, today)}
        </span>
      </button>
      {open && <Detail session={session} today={today} />}
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[15px] leading-tight font-medium text-white/85 tabular-nums">{value}</p>
      <p className="text-[10px] text-white/30">{label}</p>
    </div>
  );
}

export function History() {
  const sessions = useHistory();
  const [range, setRange] = useState<Range>('week');
  const [project, setProject] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  // Recomputed per render rather than stored: the window can sit open across
  // midnight, and "today" has to move when it does.
  const today = startOfToday();

  const projects = useMemo(() => byProject(sessions), [sessions]);

  const shown = useMemo(
    () =>
      sessions.filter(
        (s) =>
          inRange(s, range, today) &&
          (!project || projectName(s) === project) &&
          matches(s, query)
      ),
    [sessions, range, project, query, today]
  );

  const stats = useMemo(() => summarise(shown), [shown]);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="flex h-full w-full">
      <aside className="pane flex w-[228px] shrink-0 flex-col gap-5 border-r border-white/6 px-3.5 py-4">
        <div>
          {(Object.keys(RANGE_LABEL) as Range[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`block w-full rounded px-2 py-[5px] text-left text-[11px] leading-none transition-colors ${
                range === r ? 'bg-white/8 text-white/85' : 'text-white/45 hover:bg-white/4'
              }`}
            >
              {RANGE_LABEL[r]}
            </button>
          ))}
        </div>

        <div>
          <p className="mb-1.5 px-2 text-[10px] tracking-wide text-white/25 uppercase">Projects</p>
          <button
            onClick={() => setProject(null)}
            className={`block w-full rounded px-2 py-[5px] text-left text-[11px] leading-none transition-colors ${
              project === null ? 'bg-white/8 text-white/85' : 'text-white/45 hover:bg-white/4'
            }`}
          >
            All projects
          </button>
          {projects.map((p) => (
            <button
              key={p.name}
              onClick={() => setProject(p.name === project ? null : p.name)}
              title={`${p.count} sessions · ${formatElapsed(p.total)}`}
              className={`flex w-full items-baseline gap-2 rounded px-2 py-[5px] text-left text-[11px] leading-none transition-colors ${
                project === p.name ? 'bg-white/8 text-white/85' : 'text-white/45 hover:bg-white/4'
              }`}
            >
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              <span className="shrink-0 tabular-nums text-white/25">{p.count}</span>
            </button>
          ))}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="shrink-0 border-b border-white/6 px-4 py-3.5">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="search projects, files, activity…"
            autoFocus
            className="w-full rounded-md border border-white/8 bg-white/4 px-2.5 py-[6px] text-[11px] leading-none text-white/85 outline-none placeholder:text-white/25 focus:border-white/20"
          />
          <div className="mt-3.5 flex gap-7">
            <Stat label="sessions" value={String(stats.count)} />
            <Stat label="coding time" value={formatElapsed(stats.total)} />
            <Stat label="average" value={formatElapsed(stats.average)} />
            <Stat label="completed" value={`${stats.completion}%`} />
            <Stat label="asked you" value={String(stats.waited)} />
          </div>
        </header>

        <ul className="pane flex-1">
          {shown.map((s) => (
            <SessionRow
              key={s.sessionId}
              session={s}
              today={today}
              open={open === s.sessionId}
              onToggle={() => setOpen(open === s.sessionId ? null : s.sessionId)}
            />
          ))}
          {!shown.length && (
            <li className="px-4 py-6 text-[11px] text-white/30">
              {sessions.length
                ? 'nothing matches'
                : 'no sessions yet — history starts filling as Claude sessions end'}
            </li>
          )}
        </ul>
      </main>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <History />
  </React.StrictMode>
);

import { memo } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { entryText, toTimeline, type TimelineEntry } from './activity';
import type { AgentEvent, EventKind } from './protocol';

/** Lowercase, terminal-log style — these are records, not headings. */
const VERB: Record<EventKind, string> = {
  start: 'start',
  think: 'plan',
  read: 'read',
  edit: 'edit',
  run: 'run',
  test: 'test',
  wait: 'wait',
  done: 'done',
  error: 'fail',
};

const TONE: Partial<Record<EventKind, string>> = {
  error: 'text-red-400/80',
  wait: 'text-amber-400/80',
  done: 'text-emerald-400/80',
};

const HH_MM = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });

function Row({ entry, isLast, time }: { entry: TimelineEntry; isLast: boolean; time?: boolean }) {
  const { detail } = entryText(entry);
  const tone = TONE[entry.kind] ?? (isLast ? 'text-white/70' : 'text-white/32');

  return (
    <motion.li
      layout
      initial={{ opacity: 0, x: -3 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0 }}
      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
      className={`flex items-baseline text-[11px] leading-[16px] ${tone}`}
    >
      {/* Only history shows clock times: in the overlay every row happened
          seconds ago, so the column would be five identical values. */}
      {time && <span className="mr-2 shrink-0 tabular-nums text-white/25">{HH_MM.format(entry.t)}</span>}
      <span className="shrink-0 text-white/20">{isLast ? '└─' : '├─'}</span>
      <span className="ml-1.5 shrink-0">{VERB[entry.kind]}</span>
      {detail ? (
        <>
          <span className="leader" />
          {/* The overlay must not shrink this — the panel is sized *from* its
              content, so a shrinking label would measure narrower than it reads.
              A timestamped row lives in a fixed-width column instead, where the
              same rule would overflow into whatever is beside it. */}
          <span className={`truncate text-white/55 ${time ? '' : 'shrink-0'}`}>{detail}</span>
        </>
      ) : (
        <span className="leader" />
      )}
    </motion.li>
  );
}

export const Timeline = memo(function Timeline({
  events,
  limit,
  time,
}: {
  events?: AgentEvent[];
  /** How many collapsed groups to show. The overlay wants the tail; history wants all of it. */
  limit?: number;
  /** Prefix each row with its clock time. */
  time?: boolean;
}) {
  const entries = toTimeline(events, limit);
  if (!entries.length) return null;

  return (
    <ul className="flex flex-col">
      <AnimatePresence initial={false}>
        {entries.map((e, i) => (
          <Row key={e.id} entry={e} isLast={i === entries.length - 1} time={time} />
        ))}
      </AnimatePresence>
    </ul>
  );
});

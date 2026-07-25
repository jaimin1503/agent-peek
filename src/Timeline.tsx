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

function Row({ entry, isLast }: { entry: TimelineEntry; isLast: boolean }) {
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
      <span className="shrink-0 text-white/20">{isLast ? '└─' : '├─'}</span>
      <span className="ml-1.5 shrink-0">{VERB[entry.kind]}</span>
      {detail ? (
        <>
          <span className="leader" />
          <span className="shrink-0 truncate text-white/55">{detail}</span>
        </>
      ) : (
        <span className="leader" />
      )}
    </motion.li>
  );
}

export const Timeline = memo(function Timeline({ events }: { events?: AgentEvent[] }) {
  const entries = toTimeline(events);
  if (!entries.length) return null;

  return (
    <ul className="flex flex-col">
      <AnimatePresence initial={false}>
        {entries.map((e, i) => (
          <Row key={e.id} entry={e} isLast={i === entries.length - 1} />
        ))}
      </AnimatePresence>
    </ul>
  );
});

import { memo } from 'react';
import type { Activity } from './activity';

/**
 * The status indicator.
 *
 * Braille frames are the terminal convention, and the U+2800 block is why
 * Cascadia Mono is bundled — Menlo, Monaco and JetBrains Mono were each checked
 * and none carry it, so macOS falls back to Apple Braille and renders specks.
 *
 * The animation is CSS `steps()` over a translated glyph column (see `.spin` in
 * App.css): no JS runs per frame, so this costs nothing while it spins.
 */

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** Cascadia has no `✕`; `×` is the one that actually renders. */
const STATIC: Partial<Record<Activity, string>> = {
  idle: '○',
  waiting: '●',
  error: '×',
  done: '✓',
};

const COLOR: Record<Activity, string> = {
  idle: 'rgb(255 255 255 / 0.3)',
  thinking: 'rgb(255 255 255 / 0.55)',
  reading: 'rgb(56 189 248)',
  editing: 'rgb(52 211 153)',
  running: 'rgb(52 211 153)',
  testing: 'rgb(167 139 250)',
  waiting: 'rgb(251 191 36)',
  done: 'rgb(74 222 128)',
  error: 'rgb(248 113 113)',
};

export const Spinner = memo(function Spinner({ activity }: { activity: Activity }) {
  const glyph = STATIC[activity];
  const color = COLOR[activity];

  if (glyph) {
    return (
      <span
        aria-hidden
        className={activity === 'waiting' ? 'pulse' : undefined}
        style={{ color }}
      >
        {glyph}
      </span>
    );
  }

  return (
    <span className="spin" aria-hidden style={{ color }}>
      <span className="spin__col">
        {FRAMES.map((f) => (
          <i key={f}>{f}</i>
        ))}
        {/* The keyframe travels a full 10em, so the first frame is repeated at
            the end to keep the wrap seamless. */}
        <i>{FRAMES[0]}</i>
      </span>
    </span>
  );
});

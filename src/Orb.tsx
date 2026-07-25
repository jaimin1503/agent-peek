import { memo } from 'react';
import type { Activity } from './activity';

/**
 * The status orb. Every state animates, but only via `transform` and `opacity`
 * so the compositor does the work and React is not involved per frame — the
 * glow is a scaled blurred layer, never an animated box-shadow, because
 * animating shadows repaints the element on every frame.
 *
 * Keyframes live in App.css under `.orb`.
 */

const COLOR: Record<Activity, string> = {
  idle: '160 160 168',
  thinking: '214 214 222',
  reading: '56 189 248',
  editing: '52 211 153',
  running: '52 211 153',
  testing: '52 211 153',
  waiting: '251 191 36',
  done: '74 222 128',
  error: '248 113 113',
};

export const Orb = memo(function Orb({
  activity,
  size = 18,
}: {
  activity: Activity;
  size?: number;
}) {
  return (
    <span
      className={`orb orb--${activity}`}
      style={
        {
          '--orb': COLOR[activity],
          '--orb-size': `${size}px`,
        } as React.CSSProperties
      }
      aria-hidden
    >
      <span className="orb__glow" />
      <span className="orb__core" />
      {activity === 'reading' && (
        <span className="orb__orbit">
          <i />
        </span>
      )}
      {activity === 'testing' && <span className="orb__arc" />}
      {activity === 'editing' && <span className="orb__shimmer" />}
      {activity === 'done' && <span className="orb__ripple" />}
    </span>
  );
});

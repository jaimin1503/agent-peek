import { memo } from 'react';
import { motion } from 'motion/react';
import { formatTokens } from './protocol';

/**
 * Context-window usage, not task progress — agents do not expose progress, and
 * inventing one would be worse than showing nothing. This number is real, moves
 * only forward, and is worth glancing at: a session near its limit needs you.
 *
 * The fill interpolates with a spring so it never jumps between polls.
 */
export const ContextCapsule = memo(function ContextCapsule({
  used,
  max,
}: {
  used: number;
  max: number;
}) {
  const pct = Math.min(100, Math.round((used / max) * 100));
  // Context pressure is only interesting once it is high; below that it stays
  // the same quiet neutral as everything else.
  const tone = pct >= 90 ? '248 113 113' : pct >= 75 ? '251 191 36' : '255 255 255';

  return (
    <div className="flex items-center gap-2">
      <div className="h-[5px] flex-1 overflow-hidden rounded-full bg-white/[0.07]">
        <motion.div
          className="h-full rounded-full"
          style={{ background: `rgb(${tone} / ${pct >= 75 ? 0.85 : 0.22})` }}
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={{ type: 'spring', stiffness: 120, damping: 22 }}
        />
      </div>
      <span className="font-mono text-[10px] tabular-nums text-white/40">
        {formatTokens(used)}
      </span>
    </div>
  );
});

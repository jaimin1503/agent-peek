import { memo } from 'react';
import { contextPct, formatTokens } from './protocol';

const CELLS = 20;

/**
 * Context-window usage drawn in block characters.
 *
 * This is usage, not task progress — agents do not expose progress and a
 * heuristic one would be invented. It only ever moves forward, and a session
 * near its ceiling is genuinely worth knowing about, which is why it earns the
 * space.
 */
export const BlockBar = memo(function BlockBar({ used, max }: { used: number; max: number }) {
  const pct = contextPct({ used, max });
  const filled = Math.round((pct / 100) * CELLS);

  // Quiet until it matters, then increasingly not.
  const tone =
    pct >= 90 ? 'text-red-400/90' : pct >= 75 ? 'text-amber-400/85' : 'text-white/40';

  return (
    <div className="flex items-center gap-2 text-[11px] leading-none">
      <span className={`tracking-[-0.05em] ${tone}`}>
        {'█'.repeat(filled)}
        <span className="text-white/20">{'░'.repeat(CELLS - filled)}</span>
      </span>
      <span className="ml-auto tabular-nums text-white/35">{formatTokens(used)}</span>
    </div>
  );
});

import { memo, useEffect, useState } from 'react';
import { formatElapsed } from './protocol';

/**
 * Owns its own clock. The elapsed time is the only thing that changes every
 * second, so ticking it here keeps that render local — hoisting it into App
 * would re-render every card, orb and spring once a second for nothing.
 */
export const Elapsed = memo(function Elapsed({
  startedAt,
  frozen,
}: {
  startedAt: number;
  /** A finished session stops counting. */
  frozen?: number;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (frozen) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [frozen]);

  return (
    <span className="font-mono text-[10px] tabular-nums text-white/35">
      {formatElapsed((frozen ?? now) - startedAt)}
    </span>
  );
});

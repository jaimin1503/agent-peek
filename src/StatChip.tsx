import { memo } from 'react';

/** `[12 files]` — brackets rather than a pill, so it reads as terminal output. */
export const StatChip = memo(function StatChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10.5px] leading-none text-white/30">
      <span className="text-white/18">[</span>
      <span className="text-white/45">{children}</span>
      <span className="text-white/18">]</span>
    </span>
  );
});

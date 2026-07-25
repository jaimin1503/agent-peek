import { memo } from 'react';
import { Spinner } from './Spinner';
import { Elapsed } from './Elapsed';
import { activityOf } from './activity';
import type { SessionState } from './protocol';

/**
 * The resting state — what is on screen almost all of the time.
 *
 * Deliberately just the moving parts: what it is doing right now, and for how
 * long. The project name lives in the expanded view; at this size the file being
 * touched is the thing that tells you the agent is alive.
 */
export const Capsule = memo(function Capsule({
  session,
  others,
}: {
  session: SessionState;
  others: number;
}) {
  const activity = activityOf(session);
  const done = session.status === 'completed';

  return (
    <div className="flex items-center gap-2.5 px-3.5 py-[7px] text-[11px] leading-none">
      <Spinner activity={activity} />

      <span className="max-w-[190px] truncate font-medium text-white/85">{session.message}</span>

      <span className="ml-auto flex items-center gap-2 text-white/35">
        <Elapsed startedAt={session.startedAt} frozen={done ? session.updatedAt : undefined} />
        {others > 0 && <span className="text-white/30">+{others}</span>}
      </span>
    </div>
  );
});

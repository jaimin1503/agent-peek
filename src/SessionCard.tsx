import { memo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Spinner } from './Spinner';
import { Elapsed } from './Elapsed';
import { Timeline } from './Timeline';
import { BlockBar } from './BlockBar';
import { StatChip } from './StatChip';
import { ACTIVITY_VERB, activityOf } from './activity';
import { contextPct, filesModified, needsAttention, projectName, type SessionState } from './protocol';

function focusTerminal(app?: string | null) {
  if (app) invoke('focus_app', { name: app }).catch(() => {});
}

/**
 * One session, expanded. The frame is CSS borders rather than box characters —
 * a real character grid cannot survive variable-length, truncated filenames —
 * but everything that is *content* stays a character.
 */
export const SessionCard = memo(function SessionCard({
  session,
  onDismiss,
}: {
  session: SessionState;
  onDismiss: (sessionId: string) => void;
}) {
  const activity = activityOf(session);
  const attention = needsAttention(session);
  const files = filesModified(session);
  const done = session.status === 'completed';

  return (
    <div className="px-3.5 py-2.5">
      {/* ┌─ project ─────────── elapsed ─┐ */}
      <div className="flex items-center gap-2 text-[11px] leading-none">
        <Spinner activity={activity} />
        <span className="shrink-0 font-medium text-white/85">{projectName(session)}</span>
        <span className="rule" />
        <Elapsed startedAt={session.startedAt} frozen={done ? session.updatedAt : undefined} />
        {/* The escape hatch for a session that will never resolve itself — a
            dead process still holding a `permission` card, which the stale sweep
            deliberately refuses to drop. */}
        <button
          // stopPropagation twice over: the pointerdown would otherwise start a
          // window drag, and the click would toggle the card shut on the way out.
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onDismiss(session.sessionId);
          }}
          title="stop tracking"
          className="-my-1 -mr-1 shrink-0 px-1 py-1 leading-none text-white/25 transition-colors hover:text-white/70"
        >
          ×
        </button>
      </div>

      {attention ? (
        <>
          {/* The command being asked about is the whole point of this state, so
              it wraps rather than truncating into an ellipsis. */}
          <p className="mt-2 text-[11px] leading-[16px] text-white/80">{session.message}</p>
          <button
            // Stops the shell's toggle from also firing — bringing the terminal
            // forward should not collapse the card on the way out — and stops a
            // press on it from starting a window drag.
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              focusTerminal(session.terminalApp);
            }}
            disabled={!session.terminalApp}
            className="mt-2.5 rounded-md border border-amber-400/35 bg-amber-400/12 px-2.5 py-[5px] text-[10.5px] leading-none font-medium text-amber-200/90 transition-colors hover:bg-amber-400/20 disabled:opacity-40"
          >
            bring terminal ↗
          </button>
        </>
      ) : (
        <>
          <div className="mt-1.5 flex items-baseline gap-1.5 text-[11px] leading-[15px]">
            <span className="shrink-0 text-white/35">{ACTIVITY_VERB[activity].toLowerCase()}</span>
            {session.message !== ACTIVITY_VERB[activity] && (
              <span className="truncate text-white/70">{session.message}</span>
            )}
          </div>

          {session.tokens && (
            <div className="mt-2.5">
              <BlockBar used={session.tokens.used} max={session.tokens.max} />
            </div>
          )}

          <div className="mt-2.5">
            <Timeline events={session.events} />
          </div>

          {(files > 0 || session.tokens) && (
            <div className="mt-2.5 flex gap-2">
              {files > 0 && <StatChip>{files} files</StatChip>}
              {session.tokens && (
                <StatChip>{contextPct(session.tokens)}% ctx</StatChip>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
});

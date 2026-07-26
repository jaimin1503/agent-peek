import { useEffect, useMemo, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { AnimatePresence, motion } from 'motion/react';
import { useSessions } from './useSessions';
import { useOverlaySize } from './useOverlaySize';
import { useDragMove } from './useDragMove';
import { Capsule } from './Capsule';
import { SessionCard } from './SessionCard';
import { notifyChanges } from './notify';
import { updateTray } from './tray';
import { needsAttention } from './protocol';
import './App.css';

const SPRING = { type: 'spring', stiffness: 380, damping: 34 } as const;

export default function App() {
  const { sessions, dismiss } = useSessions();
  const shell = useOverlaySize<HTMLDivElement>();
  const { dragged, handlers } = useDragMove();
  /** `null` means "follow attention"; true and false are you overruling it. */
  const [open, setOpen] = useState<boolean | null>(null);

  useEffect(() => {
    notifyChanges(sessions);
    updateTray(sessions).catch(() => {});
  }, [sessions]);

  /**
   * Click anywhere else and the card closes. That click lands in another
   * application, so the webview never sees it — the overlay learns about it by
   * losing key status, which `overlay.rs` forwards as this event.
   */
  useEffect(() => {
    const pending = listen('overlay:blur', () => setOpen(false));
    return () => {
      pending.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);

  const attention = sessions.some(needsAttention);

  /**
   * Expansion is derived, not scheduled. Attention is the one moment the app
   * exists for, so it opens itself — but you can always overrule that, and the
   * override outlives the alert that provoked it. No timers to get wrong.
   */
  const expanded = open ?? attention;

  /**
   * Back to following attention on its *rising* edge only. Collapsing during an
   * alert has to stick, or the panel fights you every poll while a session waits
   * at `permission` — but the next alert is new information and gets to open the
   * panel again.
   */
  const wasAttention = useRef(attention);
  useEffect(() => {
    if (attention && !wasAttention.current) setOpen(null);
    wasAttention.current = attention;
  }, [attention]);

  /** Attention first, else the most recently active. Sessions arrive sorted. */
  const lead = useMemo(() => sessions.find(needsAttention) ?? sessions[0], [sessions]);

  return (
    // The shell is a transparent gutter: it gives the panel room to cast a
    // shadow, and widens the click target of a 28px-tall capsule.
    <div
      ref={shell}
      className="shell inline-block"
      {...handlers}
      // A press that moved the window was a drag, not a click on the card.
      onClick={() => {
        if (!dragged.current) setOpen(!expanded);
      }}
    >
      <motion.div
        layout
        transition={SPRING}
        className={`panel ${expanded ? '' : 'panel--capsule'} ${attention ? 'panel--attention' : ''}`}
      >
        <AnimatePresence initial={false} mode="wait">
          {!lead ? (
            <motion.div
              key="idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="px-3.5 py-[7px] text-[11px] leading-none text-white/25"
            >
              ○ no agents
            </motion.div>
          ) : expanded ? (
            <motion.div
              key="expanded"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="w-[330px] divide-y divide-white/6"
            >
              {sessions.map((s) => (
                <SessionCard key={s.sessionId} session={s} onDismiss={dismiss} />
              ))}
              {/* Panel-level, unlike the per-card ×: this closes the whole thing,
                  and it is the only way back out while a session wants you. */}
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                }}
                title="collapse"
                className="w-full py-1 text-[11px] leading-none text-white/25 transition-colors hover:bg-white/5 hover:text-white/50"
              >
                ⌄
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="capsule"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
            >
              <Capsule session={lead} others={sessions.length - 1} />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

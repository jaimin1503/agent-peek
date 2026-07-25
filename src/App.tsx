import { useEffect, useMemo, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { AnimatePresence, motion } from 'motion/react';
import { useSessions } from './useSessions';
import { useOverlaySize } from './useOverlaySize';
import { Capsule } from './Capsule';
import { SessionCard } from './SessionCard';
import { notifyChanges } from './notify';
import { updateTray } from './tray';
import { needsAttention } from './protocol';
import './App.css';

const SPRING = { type: 'spring', stiffness: 380, damping: 34 } as const;

export default function App() {
  const sessions = useSessions();
  const shell = useOverlaySize<HTMLDivElement>();
  const [open, setOpen] = useState(false);

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
   * Expansion is derived, not scheduled. The click is you asking; attention is
   * the one moment the app exists for, so it opens itself and closes again when
   * the session stops waiting — no timers to get wrong.
   */
  const expanded = open || attention;

  /** Attention first, else the most recently active. Sessions arrive sorted. */
  const lead = useMemo(() => sessions.find(needsAttention) ?? sessions[0], [sessions]);

  return (
    // The shell is a transparent gutter: it gives the panel room to cast a
    // shadow, and widens the click target of a 28px-tall capsule.
    <div
      ref={shell}
      className="shell inline-block"
      onClick={() => setOpen((wasOpen) => !wasOpen)}
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
                <SessionCard key={s.sessionId} session={s} />
              ))}
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

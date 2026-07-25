import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { projectName, type SessionState, type Status } from './protocol';

/** Only these are worth pulling someone back from a fullscreen app. */
const NOTIFY_ON: Status[] = ['permission', 'question', 'completed', 'error'];

const TITLES: Partial<Record<Status, string>> = {
  permission: 'needs approval',
  question: 'is waiting for you',
  completed: 'finished',
  error: 'hit an error',
};

/**
 * The last status each session was notified about. The session directory is
 * re-read on every filesystem event and on a timer, so without this a single
 * "needs approval" would re-fire every few seconds.
 */
const lastNotified = new Map<string, Status>();

// The promise is cached, not its result: the OS prompt stays open until the
// user answers it, and polling means we would otherwise ask again every second.
let granting: Promise<boolean> | null = null;
let paused = false;

export function setPaused(value: boolean) {
  paused = value;
}

export function isPaused() {
  return paused;
}

function ensurePermission(): Promise<boolean> {
  granting ??= (async () =>
    (await isPermissionGranted()) || (await requestPermission()) === 'granted')();
  return granting;
}

export async function notifyChanges(sessions: SessionState[]) {
  // Forget sessions that have gone away, so a later session reusing the id
  // (or a restarted one) is not silently suppressed.
  const live = new Set(sessions.map((s) => s.sessionId));
  for (const id of lastNotified.keys()) if (!live.has(id)) lastNotified.delete(id);

  for (const s of sessions) {
    const previous = lastNotified.get(s.sessionId);
    if (previous === s.status) continue;
    lastNotified.set(s.sessionId, s.status);

    // Fire on the transition *into* a notable state, never on the first sight
    // of a session — relaunching the app must not replay old events.
    if (previous === undefined) continue;
    if (!NOTIFY_ON.includes(s.status)) continue;
    if (paused) continue;
    if (!(await ensurePermission())) return;

    sendNotification({
      title: `${projectName(s)} ${TITLES[s.status]}`,
      body: s.message,
    });
  }
}

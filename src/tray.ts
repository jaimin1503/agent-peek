import { Menu } from '@tauri-apps/api/menu';
import { TrayIcon } from '@tauri-apps/api/tray';
import { invoke } from '@tauri-apps/api/core';
import { Window } from '@tauri-apps/api/window';
import { needsAttention, type SessionState } from './protocol';
import { isPaused, setPaused } from './notify';
import { iconsAreTemplate, trayIcon } from './trayIcons';
import { overlayHide, overlayIsVisible, overlayShow } from './overlay';

let tray: TrayIcon | null = null;
let creating: Promise<TrayIcon> | null = null;
let shownAttention: boolean | null = null;

/**
 * Raise the history window. Declared hidden in tauri.conf.json and hidden again
 * on close, so it always exists to be found by label. `setFocus` is what makes
 * the search field typable: an LSUIElement app is not active until something
 * asks, and unlike the overlay this window is meant to take focus.
 */
async function showHistory() {
  const history = await Window.getByLabel('history');
  if (!history) return;
  await history.show();
  await history.setFocus();
}

async function buildMenu() {
  return Menu.new({
    items: [
      {
        id: 'toggle',
        text: 'Show / Hide Overlay',
        // Routed through OverlayWindow, never `getCurrentWindow().show()`:
        // a window shown directly comes back unordered and stays invisible.
        action: async () => ((await overlayIsVisible()) ? overlayHide() : overlayShow()),
      },
      {
        id: 'history',
        text: 'Session History…',
        action: () => void showHistory().catch(() => {}),
      },
      {
        id: 'pause',
        text: isPaused() ? 'Resume Notifications' : 'Pause Notifications',
        action: async () => {
          setPaused(!isPaused());
          // Rebuilt rather than relabelled so the item reflects the new state.
          await tray?.setMenu(await buildMenu());
        },
      },
      { item: 'Separator' },
      { id: 'quit', text: 'Quit AgentPeek', action: () => invoke('quit') },
    ],
  });
}

/** Reflects one bit only: does anything want you right now? */
export async function updateTray(sessions: SessionState[]) {
  // React StrictMode mounts effects twice in dev; without this guard that
  // leaves two menu bar items behind.
  if (!tray) {
    creating ??= (async () =>
      TrayIcon.new({
        id: 'agentpeek',
        icon: await trayIcon(false),
        // Only true for the black pair; the white one off macOS must be drawn
        // as-is, and this field would otherwise flatten it to its alpha.
        iconAsTemplate: iconsAreTemplate,
        tooltip: 'AgentPeek',
        menu: await buildMenu(),
      }))();
    tray = await creating;
  }

  const attention = sessions.some(needsAttention);
  if (attention !== shownAttention) {
    shownAttention = attention;
    await tray.setIcon(await trayIcon(attention));
  }

  const working = sessions.filter((s) => s.status === 'working').length;
  await tray.setTooltip(
    attention
      ? 'AgentPeek — needs your attention'
      : working
        ? `AgentPeek — ${working} working`
        : 'AgentPeek — idle'
  );
}

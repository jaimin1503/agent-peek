import { invoke } from '@tauri-apps/api/core';

/**
 * The entire window API available to the frontend.
 *
 * Positioning, ordering, window level, Space behaviour and monitor selection all
 * live in `src-tauri/src/overlay.rs`. Nothing here may import from
 * `@tauri-apps/api/window` — the manager is the single authority, and a stray
 * `getCurrentWindow().show()` is precisely the bug it exists to prevent.
 */

export const overlayResize = (width: number, height: number) =>
  invoke('overlay_resize', { width, height }).catch(() => {});

/** Nudge the overlay by a pointer delta. The manager decides where that lands. */
export const overlayMoveBy = (dx: number, dy: number) =>
  invoke('overlay_move_by', { dx, dy }).catch(() => {});

export const overlayShow = () => invoke('overlay_show').catch(() => {});

export const overlayHide = () => invoke('overlay_hide').catch(() => {});

export const overlayIsVisible = () =>
  invoke<boolean>('overlay_is_visible').catch(() => true);

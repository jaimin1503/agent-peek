import { useRef } from 'react';
import { overlayMoveBy } from './overlay';

/** Movement below this is a shaky click, not a drag. */
const THRESHOLD = 3;

/**
 * Drag the whole overlay by pressing anywhere on it.
 *
 * The same press has to serve two gestures — move the window, or toggle the card
 * — so the distinction is distance travelled, and `dragged` is what lets the
 * click handler tell them apart. It stays set through the `click` that follows a
 * drag's `pointerup` and is cleared by the next `pointerdown`.
 */
export function useDragMove() {
  /** Screen position of the last delta we sent, or null when not pressed. */
  const from = useRef<{ x: number; y: number } | null>(null);
  const dragged = useRef(false);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    from.current = { x: e.screenX, y: e.screenY };
    dragged.current = false;
    // Capture, or the pointer outruns a window that is chasing it and the drag
    // dies the moment the cursor leaves the panel.
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const origin = from.current;
    if (!origin) return;

    // Screen coordinates, never client ones: the window moves out from under a
    // stationary pointer, so client deltas would read that movement back in as
    // input and the panel would slide away on its own.
    const dx = e.screenX - origin.x;
    const dy = e.screenY - origin.y;
    if (!dragged.current && Math.hypot(dx, dy) < THRESHOLD) return;

    dragged.current = true;
    from.current = { x: e.screenX, y: e.screenY };
    // ponytail: one invoke per event, no rAF coalescing — pointermove already
    // fires about once a frame. Batch it if the main-thread hop per event ever
    // shows up as drag jitter.
    overlayMoveBy(dx, dy);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    from.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  return { dragged, handlers: { onPointerDown, onPointerMove, onPointerUp } };
}

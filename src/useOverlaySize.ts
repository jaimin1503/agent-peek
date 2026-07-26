import { useEffect, useRef } from 'react';
import { overlayResize } from './overlay';

/** Below this, a resize is sub-pixel layout noise and not worth reporting. */
const EPSILON = 2;
/** Long enough for the expand spring to settle before the window shrinks. */
const SHRINK_DELAY_MS = 220;

/**
 * Reports the panel's measured size to the window manager. That is all it does —
 * keeping the window on screen is the manager's own job, on its own thread, since
 * a throttled webview cannot be trusted to repair the thing that unthrottles it.
 *
 * Growing and shrinking stay asymmetric: grow immediately so an expanding card is
 * never clipped by a window still catching up, and shrink only once the collapse
 * animation has settled, so the window does not chase the spring frame by frame.
 */
export function useOverlaySize<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let reported = { width: 0, height: 0 };
    let shrinkTimer: ReturnType<typeof setTimeout> | undefined;

    const report = (size: { width: number; height: number }) => {
      reported = size;
      overlayResize(size.width, size.height);
    };

    const measure = () => ({
      width: Math.ceil(el.getBoundingClientRect().width) || 300,
      height: Math.ceil(el.getBoundingClientRect().height),
    });

    // Both axes matter. The capsule changes width without changing height all the
    // time — a longer message, elapsed ticking 9m -> 10m — and watching height
    // alone left those resizes unreported until the next expand happened to move
    // it too, so the text sat clipped by a window that had stopped following.
    const observer = new ResizeObserver(() => {
      const size = measure();
      if (!size.height) return;

      const dw = size.width - reported.width;
      const dh = size.height - reported.height;
      if (Math.abs(dw) < EPSILON && Math.abs(dh) < EPSILON) return;

      clearTimeout(shrinkTimer);
      if (dw > 0 || dh > 0) report(size);
      else shrinkTimer = setTimeout(() => report(size), SHRINK_DELAY_MS);
    });
    observer.observe(el);

    return () => {
      clearTimeout(shrinkTimer);
      observer.disconnect();
    };
  }, []);

  return ref;
}

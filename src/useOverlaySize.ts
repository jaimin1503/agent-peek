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

    let reported = 0;
    let shrinkTimer: ReturnType<typeof setTimeout> | undefined;

    const report = (width: number, height: number) => {
      reported = height;
      overlayResize(width, height);
    };

    const measure = () => ({
      width: Math.ceil(el.getBoundingClientRect().width) || 300,
      height: Math.ceil(el.getBoundingClientRect().height),
    });

    const observer = new ResizeObserver(() => {
      const { width, height } = measure();
      if (!height || Math.abs(height - reported) < EPSILON) return;

      clearTimeout(shrinkTimer);
      if (height > reported) report(width, height);
      else shrinkTimer = setTimeout(() => report(width, height), SHRINK_DELAY_MS);
    });
    observer.observe(el);

    return () => {
      clearTimeout(shrinkTimer);
      observer.disconnect();
    };
  }, []);

  return ref;
}

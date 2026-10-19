import { useEffect, useState, useSyncExternalStore, type RefObject } from 'react';

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_QUERY).matches;
}

function subscribeReducedMotion(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const query = window.matchMedia(REDUCED_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/**
 * The server cannot know the preference, so server HTML and the hydrating render both assume motion.
 * React then re-renders with the real client value, which keeps hydration free of mismatches.
 */
function serverReducedMotion(): boolean {
  return false;
}

/** Tracks the user's reduced-motion preference live. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, serverReducedMotion);
}

/**
 * True while the element is on screen and the tab is visible. Also sets `data-paused` on the
 * element so CSS loops stop with it. Always false when `enabled` is false.
 */
export function useAvatarActive(ref: RefObject<HTMLElement | null>, enabled: boolean): boolean {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element) {
      setActive(false);
      return;
    }
    let visible = true;
    let onScreen = true;
    const update = () => {
      const next = visible && onScreen;
      if (next) element.removeAttribute('data-paused');
      else element.setAttribute('data-paused', 'true');
      setActive(next);
    };

    const onVisibility = () => {
      visible = document.visibilityState !== 'hidden';
      update();
    };
    document.addEventListener('visibilitychange', onVisibility);

    let observer: IntersectionObserver | undefined;
    if (typeof IntersectionObserver === 'function') {
      observer = new IntersectionObserver((entries) => {
        const entry = entries.at(-1);
        if (!entry) return;
        onScreen = entry.isIntersecting;
        update();
      });
      observer.observe(element);
    }
    onVisibility();

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      observer?.disconnect();
      element.removeAttribute('data-paused');
    };
  }, [ref, enabled]);

  return active;
}

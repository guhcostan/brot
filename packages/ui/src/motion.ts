import { useEffect, useState, type RefObject } from 'react';

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_QUERY).matches;
}

/** Tracks the user's reduced-motion preference live. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(REDUCED_QUERY);
    const onChange = () => setReduced(query.matches);
    onChange();
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
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

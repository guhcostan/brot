import { useEffect, useState, type RefObject } from 'react';

/**
 * True while the element is on screen and the tab is visible, so scripted demos only run
 * when someone can see them.
 */
export function useInView(ref: RefObject<HTMLElement | null>): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let onScreen = false;
    let visible = document.visibilityState !== 'hidden';
    const update = () => setInView(onScreen && visible);
    const onVisibility = () => {
      visible = document.visibilityState !== 'hidden';
      update();
    };
    document.addEventListener('visibilitychange', onVisibility);
    const observer =
      typeof IntersectionObserver === 'function'
        ? new IntersectionObserver(
            (entries) => {
              const entry = entries.at(-1);
              if (!entry) return;
              onScreen = entry.isIntersecting;
              update();
            },
            { threshold: 0.15 },
          )
        : undefined;
    if (observer) observer.observe(element);
    else {
      onScreen = true;
      update();
    }
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      observer?.disconnect();
    };
  }, [ref]);
  return inView;
}

/**
 * Steps through a scripted timeline: `durations[i]` is how long step `i` holds before the next one.
 * Loops back to 0 after the last step and pauses while `running` is false. A non-null `still`
 * pins that step and never advances (used for reduced motion).
 */
export function useTimeline(durations: readonly number[], running: boolean, still: number | null): number {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (still !== null) {
      setStep(still);
      return;
    }
    if (!running) return;
    const hold = durations[step] ?? 1000;
    const timer = setTimeout(() => setStep((current) => (current + 1) % durations.length), hold);
    return () => clearTimeout(timer);
  }, [durations, running, still, step]);
  return still ?? step;
}

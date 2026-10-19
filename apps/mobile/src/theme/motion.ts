import { motion } from '@brot/ui/tokens';
import { Easing, FadeOut, ReduceMotion, withTiming, type EntryExitAnimationFunction } from 'react-native-reanimated';

/** motion.ease from the tokens, cubic-bezier(0.2, 0, 0, 1). */
export const EASE = Easing.bezier(0.2, 0, 0, 1);

export const timing = (duration: number = motion.base) => ({ duration, easing: EASE });

/**
 * Entrances from DESIGN.md section 2: new items rise a few points while fading in. With reduce
 * motion on they become a plain fade (Reanimated would otherwise skip the animation entirely).
 */
export function riseIn(reduced: boolean, distance = 6, duration: number = motion.base): EntryExitAnimationFunction {
  const lift = reduced ? 0 : distance;
  return () => {
    'worklet';
    const config = { duration, easing: EASE, reduceMotion: ReduceMotion.Never };
    return {
      initialValues: { opacity: 0, transform: [{ translateY: lift }] },
      animations: { opacity: withTiming(1, config), transform: [{ translateY: withTiming(0, config) }] },
    };
  };
}

export function fadeOut(duration: number = motion.fast) {
  return FadeOut.duration(duration).reduceMotion(ReduceMotion.Never);
}

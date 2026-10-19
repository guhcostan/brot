import { motion } from '@brot/ui/tokens';
import type { ReactElement } from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { createAnimatedComponent, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { EASE } from '../theme/motion';

const AnimatedPressable = createAnimatedComponent(Pressable);

export interface PressScaleProps extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle>;
  /** Scale while held. DESIGN.md asks for a small press scale on the send button and actions. */
  pressedScale?: number;
}

/** A Pressable that shrinks slightly while held. Reduce motion turns the scale off. */
export function PressScale({ style, pressedScale = 0.96, onPressIn, onPressOut, disabled, ...rest }: PressScaleProps): ReactElement {
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={(event) => {
        if (!reduced) scale.value = withTiming(pressedScale, { duration: motion.fast, easing: EASE });
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        scale.value = withTiming(1, { duration: motion.base, easing: EASE });
        onPressOut?.(event);
      }}
      style={[style, animated]}
    />
  );
}

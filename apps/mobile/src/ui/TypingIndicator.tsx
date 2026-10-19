import { useEffect, type ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useTheme } from '../theme/ThemeProvider';

const PERIOD_MS = 1200;
const STAGGER_MS = 150;

function Dot({ progress, color, still }: { progress: SharedValue<number>; color: string; still: boolean }): ReactElement {
  const style = useAnimatedStyle(() => {
    if (still) return { opacity: 0.6, transform: [{ translateY: 0 }] };
    const p = progress.value;
    return {
      opacity: interpolate(p, [0, 0.3, 0.6, 1], [0.35, 1, 0.35, 0.35]),
      transform: [{ translateY: interpolate(p, [0, 0.3, 0.6, 1], [0, -2, 0, 0]) }],
    };
  });
  return <Animated.View style={[styles.dot, { backgroundColor: color }, style]} />;
}

/** Three dots pulsing in sequence while a bot works (DESIGN.md section 2). Still under reduce motion. */
export function TypingIndicator({ label }: { label: string }): ReactElement {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const a = useSharedValue(0);
  const b = useSharedValue(0);
  const c = useSharedValue(0);

  useEffect(() => {
    const values = [a, b, c];
    if (reduced) return;
    values.forEach((value, index) => {
      value.value = withDelay(index * STAGGER_MS, withRepeat(withTiming(1, { duration: PERIOD_MS, easing: Easing.inOut(Easing.ease) }), -1));
    });
    return () => values.forEach((value) => cancelAnimation(value));
  }, [a, b, c, reduced]);

  return (
    <View style={styles.row} accessible accessibilityRole="progressbar" accessibilityLabel={label} accessibilityLiveRegion="polite">
      <Dot progress={a} color={theme.color.ink3} still={reduced} />
      <Dot progress={b} color={theme.color.ink3} still={reduced} />
      <Dot progress={c} color={theme.color.ink3} still={reduced} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 20 },
  dot: { width: 6, height: 6, borderRadius: 3 },
});

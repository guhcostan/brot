import { useRef, useState, type ReactElement } from 'react';
import { Image, PanResponder, StyleSheet, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { useTheme } from '../theme/ThemeProvider';
import { clampZoom, NO_ZOOM, pinchZoom, viewToDesktop, type Size, type Zoom } from './geometry';

export interface LiveScreenProps {
  /** The latest frame as a data URI. */
  uri?: string;
  /** During a takeover taps become clicks; otherwise the screen is view-only. */
  interactive: boolean;
  onTap?: (point: { x: number; y: number }) => void;
  accessibilityLabel: string;
  /** Rendered over the screen when there is no frame yet (loading, off, errors). */
  placeholder?: ReactElement | null;
}

const TAP_SLOP = 8;
const TAP_MS = 350;
const DOUBLE_TAP_MS = 280;

function distance(event: GestureResponderEvent): number {
  const [a, b] = event.nativeEvent.touches;
  if (!a || !b) return 0;
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
}

function midpoint(event: GestureResponderEvent): { x: number; y: number } {
  const [a, b] = event.nativeEvent.touches;
  if (!a || !b) return { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY };
  return { x: (a.locationX + b.locationX) / 2, y: (a.locationY + b.locationY) / 2 };
}

/**
 * The bot's desktop, fitted to the view. Pinch zooms around the fingers, one finger pans a zoomed
 * screen, and a double tap resets the zoom when view-only. Frames are double-buffered: a new frame
 * replaces the old one only once it has decoded, so the screen never blinks to empty between polls.
 */
export function LiveScreen({ uri, interactive, onTap, accessibilityLabel, placeholder }: LiveScreenProps): ReactElement {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const [view, setView] = useState<Size>({ width: 0, height: 0 });
  const [shown, setShown] = useState<string>();
  const [pending, setPending] = useState<string>();
  const zoom = useRef<Zoom>(NO_ZOOM);
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const ripple = useSharedValue(0);
  const rippleX = useSharedValue(0);
  const rippleY = useSharedValue(0);

  if (uri && uri !== shown && uri !== pending) setPending(uri);

  const viewRef = useRef(view);
  viewRef.current = view;
  const tapRef = useRef({ interactive, onTap });
  tapRef.current = { interactive, onTap };

  const apply = (next: Zoom, animate = false) => {
    zoom.current = next;
    const config = { duration: reduced ? 0 : theme.motion.base };
    scale.value = animate ? withTiming(next.scale, config) : next.scale;
    tx.value = animate ? withTiming(next.tx, config) : next.tx;
    ty.value = animate ? withTiming(next.ty, config) : next.ty;
  };

  const gesture = useRef({ startDistance: 0, startZoom: NO_ZOOM, startX: 0, startY: 0, startAt: 0, moved: false, pinched: false, lastTapAt: 0 });

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (event) => {
        const g = gesture.current;
        g.startZoom = zoom.current;
        g.startX = event.nativeEvent.locationX;
        g.startY = event.nativeEvent.locationY;
        g.startAt = Date.now();
        g.moved = false;
        g.pinched = event.nativeEvent.touches.length >= 2;
        g.startDistance = distance(event);
      },
      onPanResponderMove: (event, state) => {
        const g = gesture.current;
        const touches = event.nativeEvent.touches.length;
        if (touches >= 2) {
          if (!g.pinched || g.startDistance === 0) {
            g.pinched = true;
            g.startDistance = distance(event);
            g.startZoom = zoom.current;
            return;
          }
          g.moved = true;
          apply(pinchZoom(g.startZoom, distance(event) / g.startDistance, midpoint(event), viewRef.current));
          return;
        }
        if (Math.hypot(state.dx, state.dy) > TAP_SLOP) g.moved = true;
        if (g.moved && !g.pinched && g.startZoom.scale > 1) {
          apply(clampZoom({ ...g.startZoom, tx: g.startZoom.tx + state.dx, ty: g.startZoom.ty + state.dy }, viewRef.current));
        }
      },
      onPanResponderRelease: () => {
        const g = gesture.current;
        if (g.moved || g.pinched || Date.now() - g.startAt > TAP_MS) return;
        const { interactive: live, onTap: tap } = tapRef.current;
        if (live) {
          const point = viewToDesktop({ x: g.startX, y: g.startY }, viewRef.current, zoom.current);
          if (!point) return;
          rippleX.value = g.startX;
          rippleY.value = g.startY;
          ripple.value = withSequence(withTiming(1, { duration: 0 }), withTiming(0, { duration: 420 }));
          tap?.(point);
          return;
        }
        const now = Date.now();
        if (now - g.lastTapAt < DOUBLE_TAP_MS) {
          g.lastTapAt = 0;
          apply(NO_ZOOM, true);
        } else {
          g.lastTapAt = now;
        }
      },
    }),
  ).current;

  const transform = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }] }));
  const rippleStyle = useAnimatedStyle(() => ({
    opacity: ripple.value * 0.5,
    transform: [{ translateX: rippleX.value - 18 }, { translateY: rippleY.value - 18 }, { scale: 1.6 - ripple.value * 0.6 }],
  }));

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setView({ width, height });
    apply(clampZoom(zoom.current, { width, height }));
  };

  return (
    <View
      onLayout={onLayout}
      style={[styles.frame, { backgroundColor: theme.color.surface2, borderRadius: theme.radius.lg, borderColor: interactive ? theme.color.attention : theme.color.line }]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      {...responder.panHandlers}
    >
      <Animated.View style={[StyleSheet.absoluteFill, transform]} pointerEvents="none">
        {shown ? <Image source={{ uri: shown }} style={StyleSheet.absoluteFill} resizeMode="contain" fadeDuration={0} /> : null}
        {pending ? (
          <Image
            source={{ uri: pending }}
            style={[StyleSheet.absoluteFill, styles.hidden]}
            resizeMode="contain"
            fadeDuration={0}
            onLoad={() => {
              setShown(pending);
              setPending(undefined);
            }}
            onError={() => setPending(undefined)}
          />
        ) : null}
      </Animated.View>
      {!shown && placeholder ? <View style={[StyleSheet.absoluteFill, styles.center]}>{placeholder}</View> : null}
      <Animated.View pointerEvents="none" style={[styles.ripple, { borderColor: theme.color.ink }, rippleStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { width: '100%', aspectRatio: 1280 / 800, overflow: 'hidden', borderWidth: 2 },
  hidden: { opacity: 0 },
  center: { alignItems: 'center', justifyContent: 'center' },
  ripple: { position: 'absolute', left: 0, top: 0, width: 36, height: 36, borderRadius: 18, borderWidth: 2 },
});

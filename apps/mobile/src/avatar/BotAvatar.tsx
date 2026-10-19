import {
  AVATAR_VIEWBOX,
  BACK_POSE,
  EYE_STROKE,
  FRONT_POSE,
  SPECIES_GEOMETRY,
  poseTransform,
  toSpecies,
  type AvatarMood,
  type AvatarPart,
  type AvatarShape,
  type AvatarSpecies,
} from '@brot/ui/avatar';
import { createBlinkScheduler } from '@brot/ui/blink';
import type { AvatarColor } from '@brot/ui/tokens';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  createAnimatedComponent,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';
import { useAppActive } from '../theme/useAppActive';
import { eyePair, mixPair, posePair, quadPath } from './eyes';
import { BLINK_MS, GLANCE_REACH, MOOD_MOTION, MORPH_MS, SUCCESS_HOLD_MS } from './moodMotion';

const AnimatedPath = createAnimatedComponent(Path);

export type AvatarSize = 'sm' | 'md' | 'lg' | 'xl';
export const AVATAR_SIZE_PT: Record<AvatarSize, number> = { sm: 24, md: 32, lg: 44, xl: 72 };

export interface BotAvatarProps {
  species?: AvatarSpecies;
  /** @deprecated Use `species`. A legacy shape name resolves to its species. */
  shape?: AvatarShape;
  color: AvatarColor;
  mood?: AvatarMood;
  size?: AvatarSize | number;
  /** Accessible name. Omit when the bot's name is already next to the avatar. */
  label?: string;
  /** False renders a still face: no blinks or loops. */
  animated?: boolean;
}

const inOut = Easing.inOut(Easing.ease);

function Part({ part, fill }: { part: AvatarPart; fill: string }): ReactElement {
  switch (part.kind) {
    case 'circle':
      return <Circle cx={part.cx} cy={part.cy} r={part.r} fill={fill} />;
    case 'ellipse':
      return (
        <Ellipse
          cx={part.cx}
          cy={part.cy}
          rx={part.rx}
          ry={part.ry}
          fill={fill}
          transform={part.rotate ? `rotate(${part.rotate} ${part.cx} ${part.cy})` : undefined}
        />
      );
    case 'rect':
      return <Rect x={part.x} y={part.y} width={part.width} height={part.height} rx={part.rx} fill={fill} />;
    case 'path':
      return <Path d={part.d} fill={fill} />;
  }
}

/** Success shows the smiling hop, then settles back to idle on its own, like the web avatar. */
function useDisplayMood(mood: AvatarMood): AvatarMood {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    setSettled(false);
    if (mood !== 'success') return;
    const timer = setTimeout(() => setSettled(true), SUCCESS_HOLD_MS);
    return () => clearTimeout(timer);
  }, [mood]);
  return mood === 'success' && settled ? 'idle' : mood;
}

/**
 * A bot's face (DESIGN.md section 2): the same Brazilian animal heads as the web BotAvatar. Eye strokes
 * morph between moods on the UI thread; blinks and glances come at random gaps; loops pause while
 * the app is in the background, and reduce motion leaves a still face whose eyes change instantly.
 */
export function BotAvatar({ species: speciesProp, shape, color, mood = 'idle', size = 'md', label, animated = true }: BotAvatarProps): ReactElement {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const appActive = useAppActive();
  const shown = useDisplayMood(mood);
  const live = animated && !reduced && appActive;

  const px = typeof size === 'number' ? size : AVATAR_SIZE_PT[size];
  const species = speciesProp ?? (shape ? toSpecies(shape) : undefined) ?? 'capivara';
  const geometry = SPECIES_GEOMETRY[species];
  const anchorY = geometry.eyes.y;
  const paint = theme.avatar(color);
  const [phase] = useState(() => Math.random());

  const initial = useRef(eyePair(shown, geometry.eyes, geometry.eyeGap)).current;
  const from = useSharedValue<number[]>(initial);
  const to = useSharedValue<number[]>(initial);
  const morph = useSharedValue(1);
  const open = useSharedValue(1);
  const gx = useSharedValue(0);
  const gy = useSharedValue(0);
  const scale = useSharedValue(1);
  const lift = useSharedValue(0);
  const shakeX = useSharedValue(0);

  // Morph the eye strokes to the new mood. Species changes re-anchor without a morph.
  const lastSpecies = useRef(species);
  useEffect(() => {
    const target = eyePair(shown, geometry.eyes, geometry.eyeGap);
    const instant = !animated || reduced || lastSpecies.current !== species;
    lastSpecies.current = species;
    if (instant) {
      from.value = target;
      to.value = target;
      morph.value = 1;
      return;
    }
    from.value = mixPair(from.value, to.value, morph.value);
    to.value = target;
    morph.value = 0;
    morph.value = withTiming(1, { duration: MORPH_MS, easing: inOut });
  }, [shown, species, geometry.eyes, geometry.eyeGap, animated, reduced, from, to, morph]);

  // Per-mood life: blinks, glances, scanning, breathing, bobbing and entrance reactions.
  useEffect(() => {
    const plan = MOOD_MOTION[shown];
    const look = plan.look ?? { x: 0, y: 0 };
    const all = [open, gx, gy, scale, lift, shakeX];
    if (!live) {
      all.forEach((value) => cancelAnimation(value));
      open.value = 1;
      gx.value = animated ? look.x : 0;
      gy.value = animated ? look.y : 0;
      scale.value = 1;
      lift.value = 0;
      shakeX.value = 0;
      return;
    }

    const settle = { duration: MORPH_MS, easing: inOut };
    gx.value = withTiming(look.x, settle);
    gy.value = withTiming(look.y, settle);
    const cleanups: (() => void)[] = [];

    if (plan.blink) {
      const blinks = createBlinkScheduler({
        minMs: plan.blink[0],
        maxMs: plan.blink[1],
        onBlink: () => {
          open.value = withSequence(withTiming(0.12, { duration: BLINK_MS / 2 }), withTiming(1, { duration: BLINK_MS / 2 }));
        },
      });
      blinks.start();
      cleanups.push(() => blinks.stop());
    }
    if (plan.glance) {
      const glances = createBlinkScheduler({
        minMs: plan.glance[0],
        maxMs: plan.glance[1],
        onBlink: () => {
          const side = Math.random() < 0.5 ? -1 : 1;
          gx.value = withSequence(
            withTiming(look.x + side * GLANCE_REACH, { duration: 420, easing: inOut }),
            withDelay(900, withTiming(look.x, { duration: 420, easing: inOut })),
          );
        },
      });
      glances.start();
      cleanups.push(() => glances.stop());
    }
    if (plan.scanMs) {
      const leg = { duration: plan.scanMs, easing: inOut };
      gx.value = withSequence(
        withTiming(-GLANCE_REACH, { duration: plan.scanMs / 2, easing: inOut }),
        withRepeat(withSequence(withTiming(GLANCE_REACH, leg), withTiming(-GLANCE_REACH, leg)), -1),
      );
    }
    if (plan.breathe) {
      const half = { duration: plan.breathe.periodMs / 2, easing: inOut };
      scale.value = withDelay(
        phase * plan.breathe.periodMs,
        withRepeat(withSequence(withTiming(plan.breathe.scale, half), withTiming(1, half)), -1),
      );
    }
    if (plan.bob) {
      const height = plan.bob.lift * px;
      lift.value = withDelay(
        phase * plan.bob.everyMs,
        withRepeat(
          withSequence(
            withTiming(-height, { duration: 180, easing: Easing.out(Easing.quad) }),
            withTiming(0, { duration: 240, easing: Easing.in(Easing.quad) }),
            withDelay(plan.bob.everyMs, withTiming(0, { duration: 0 })),
          ),
          -1,
        ),
      );
    }
    if (plan.enter === 'shake') {
      const reach = Math.max(1, px * 0.05);
      const step = { duration: 60 };
      shakeX.value = withSequence(
        withTiming(-reach, step),
        withTiming(reach, step),
        withTiming(-reach / 2, step),
        withTiming(0, step),
      );
    }
    if (plan.enter === 'hop') {
      const height = px * 0.14;
      lift.value = withSequence(
        withTiming(-height, { duration: 150, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: 150, easing: Easing.in(Easing.quad) }),
      );
    }

    return () => {
      cleanups.forEach((stop) => stop());
      all.forEach((value) => cancelAnimation(value));
      open.value = 1;
      scale.value = withTiming(1, settle);
      lift.value = withTiming(0, settle);
      shakeX.value = 0;
    };
  }, [shown, live, animated, phase, px, open, gx, gy, scale, lift, shakeX]);

  const leftEye = useAnimatedProps(() => {
    const pose = posePair(mixPair(from.value, to.value, morph.value), anchorY, open.value, gx.value, gy.value);
    return { d: quadPath(pose, 0) };
  });
  const rightEye = useAnimatedProps(() => {
    const pose = posePair(mixPair(from.value, to.value, morph.value), anchorY, open.value, gx.value, gy.value);
    return { d: quadPath(pose, 6) };
  });
  const body = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeX.value }, { translateY: lift.value }, { scale: scale.value }],
  }));

  const a11y = label
    ? { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel: label }
    : { accessible: false, accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const };

  return (
    <View {...a11y} style={{ width: px, height: px }}>
      <Animated.View style={[{ width: px, height: px }, body]}>
        <Svg width={px} height={px} viewBox={`0 0 ${AVATAR_VIEWBOX} ${AVATAR_VIEWBOX}`}>
          {geometry.back.length > 0 ? (
            <G transform={poseTransform(BACK_POSE[shown], geometry.backPivot)}>
              {geometry.back.map((part, index) => (
                <Part key={index} part={part} fill={paint[part.ink]} />
              ))}
            </G>
          ) : null}
          {geometry.head.map((part, index) => (
            <Part key={index} part={part} fill={paint[part.ink]} />
          ))}
          {geometry.front.length > 0 ? (
            <G transform={poseTransform(FRONT_POSE[shown], geometry.frontPivot)}>
              {geometry.front.map((part, index) => (
                <Part key={index} part={part} fill={paint[part.ink]} />
              ))}
            </G>
          ) : null}
          <AnimatedPath d={quadPath(initial, 0)} animatedProps={leftEye} stroke={paint.eye} strokeWidth={EYE_STROKE} strokeLinecap="round" fill="none" />
          <AnimatedPath d={quadPath(initial, 6)} animatedProps={rightEye} stroke={paint.eye} strokeWidth={EYE_STROKE} strokeLinecap="round" fill="none" />
        </Svg>
      </Animated.View>
    </View>
  );
}

/** The black capybara with idle eyes, still, like the app icon. */
export function BrandMark({ size = 'sm' }: { size?: AvatarSize | number }): ReactElement {
  return <BotAvatar species="capivara" color="black" size={size} animated={false} />;
}

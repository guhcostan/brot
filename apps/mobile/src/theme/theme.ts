import {
  AVATAR_COLORS,
  colorDark,
  colorLight,
  fontSize,
  lineHeight,
  motion,
  radius,
  shadow,
  space,
  tracking,
  type AvatarColor,
  type AvatarPaint,
  type ColorToken,
  type ThemeName,
} from '@brot/ui/tokens';

/** Font family names as registered by expo-font in app/_layout.tsx (Inter and JetBrains Mono, DESIGN.md section 5). */
export const FONT = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  mono: 'JetBrainsMono_400Regular',
  monoMedium: 'JetBrainsMono_500Medium',
} as const;

export type FontWeightName = keyof typeof FONT;

export interface Theme {
  name: ThemeName;
  color: Record<ColorToken, string>;
  radius: typeof radius;
  space: typeof space;
  fontSize: typeof fontSize;
  motion: typeof motion;
  /** CSS box-shadow, which React Native accepts as `boxShadow` on the new architecture. */
  floatShadow: string;
  avatar(color: AvatarColor): AvatarPaint;
}

/** Converts an em tracking token to React Native's point-based letterSpacing. */
export function letterSpacing(token: keyof typeof tracking, size: number): number {
  return Number.parseFloat(tracking[token]) * size;
}

export function lineHeightFor(size: number, kind: keyof typeof lineHeight = 'body'): number {
  return Math.round(size * lineHeight[kind]);
}

export function makeTheme(name: ThemeName): Theme {
  return {
    name,
    color: name === 'dark' ? colorDark : colorLight,
    radius,
    space,
    fontSize,
    motion,
    floatShadow: shadow.float,
    avatar: (avatarColor) => AVATAR_COLORS[avatarColor][name],
  };
}

export const THEMES: Record<ThemeName, Theme> = { light: makeTheme('light'), dark: makeTheme('dark') };

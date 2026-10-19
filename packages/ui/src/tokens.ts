/*
 * Design tokens as plain values, mirroring tokens.css (DESIGN.md sections 2 and 4-6).
 * No DOM access, so the React Native app can import this file as-is.
 * tokens.test.ts fails if these values drift from tokens.css.
 */

export const colorLight = {
  bg: '#FFFFFF',
  surface: '#FFFFFF',
  surface2: '#F5F5F5',
  line: '#E5E5E5',
  ink: '#0A0A0A',
  ink2: '#525252',
  ink3: '#6F6F6F',
  primary: '#0A0A0A',
  primaryInk: '#FFFFFF',
  focus: '#0A0A0A',
  attention: '#DC2626',
  attentionText: '#B91C1C',
  attentionSoft: '#FEF2F2',
} as const;

export const colorDark = {
  bg: '#0A0A0A',
  surface: '#141414',
  surface2: '#1C1C1C',
  line: '#262626',
  ink: '#FAFAFA',
  ink2: '#A3A3A3',
  ink3: '#8A8A8A',
  primary: '#FAFAFA',
  primaryInk: '#0A0A0A',
  focus: '#FAFAFA',
  attention: '#EF4444',
  attentionText: '#F87171',
  attentionSoft: '#2A1212',
} as const;

export const color = { light: colorLight, dark: colorDark } as const;

export const AVATAR_COLOR_NAMES = ['black', 'teal', 'violet', 'blue', 'orange', 'amber', 'pink', 'brown', 'gray'] as const;
export type AvatarColor = (typeof AVATAR_COLOR_NAMES)[number];

export interface AvatarPaint {
  fill: string;
  eye: string;
}

const paint = (fill: string): { light: AvatarPaint; dark: AvatarPaint } => ({
  light: { fill, eye: '#FFFFFF' },
  dark: { fill, eye: '#FFFFFF' },
});

/** Avatar-only colors. Never used in chrome. */
export const AVATAR_COLORS: Record<AvatarColor, { light: AvatarPaint; dark: AvatarPaint }> = {
  black: { light: { fill: '#111111', eye: '#FFFFFF' }, dark: { fill: '#F2F2F2', eye: '#111111' } },
  teal: paint('#14B8A6'),
  violet: paint('#8B5CF6'),
  blue: paint('#3B82F6'),
  orange: paint('#F97316'),
  amber: paint('#F59E0B'),
  pink: paint('#EC4899'),
  brown: paint('#92400E'),
  gray: paint('#9CA3AF'),
};

export const shadow = { float: '0 1px 2px rgba(0, 0, 0, 0.04), 0 8px 24px rgba(0, 0, 0, 0.06)' } as const;

export const radius = { sm: 6, md: 10, lg: 14, xl: 20, full: 999 } as const;

export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 6: 24, 8: 32, 12: 48, 16: 64 } as const;

export const fontFamily = {
  ui: '"Inter Variable", Inter, system-ui, -apple-system, "Segoe UI", sans-serif',
  code: '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
} as const;

export const fontSize = { xs: 12, sm: 13, base: 14, md: 16, lg: 20, xl: 24, '2xl': 32, '3xl': 48 } as const;

export const lineHeight = { body: 1.5, heading: 1.2 } as const;

export const tracking = { heading: '-0.01em', tight: '-0.02em' } as const;

export const motion = { fast: 120, base: 160, ease: 'cubic-bezier(0.2, 0, 0, 1)' } as const;

export const tokens = { color, avatar: AVATAR_COLORS, shadow, radius, space, fontFamily, fontSize, lineHeight, tracking, motion } as const;
export type Tokens = typeof tokens;
export type ThemeName = keyof typeof color;
export type ColorToken = keyof typeof colorLight;

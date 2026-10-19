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

export const AVATAR_COLOR_NAMES = ['black', 'teal', 'violet', 'blue', 'orange', 'amber', 'pink', 'brown', 'gray', 'white'] as const;
export type AvatarColor = (typeof AVATAR_COLOR_NAMES)[number];

export interface AvatarPaint {
  /** The head. */
  fill: string;
  /** One darker or lighter step of the same hue for snouts, ears, spots and beaks. */
  tone: string;
  eye: string;
}

const hexToHsl = (hex: string): [number, number, number] => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
};

const hslToHex = (h: number, s: number, l: number): string => {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return `#${[0, 8, 4]
    .map((n) => Math.round(channel(n) * 255).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
};

/**
 * The detail tone for an avatar color: the same hue and saturation with lightness shifted by
 * `delta` (negative is darker). tokens.css holds the resulting literals.
 */
export function avatarTone(fill: string, delta: number): string {
  const [h, s, l] = hexToHsl(fill);
  return hslToHex(h, s, Math.min(1, Math.max(0, l + delta)));
}

const INK = '#111111';
const WHITE = '#FFFFFF';

const paint = (fill: string, delta: number, eye: string = WHITE): AvatarPaint => ({ fill, tone: avatarTone(fill, delta), eye });
const same = (p: AvatarPaint) => ({ light: p, dark: p });

/** Avatar-only colors. Never used in chrome. Eyes are white on dark heads and near-black on light ones. */
export const AVATAR_COLORS: Record<AvatarColor, { light: AvatarPaint; dark: AvatarPaint }> = {
  black: { light: paint('#111111', 0.2), dark: paint('#F2F2F2', -0.3, INK) },
  teal: same(paint('#14B8A6', -0.13)),
  violet: same(paint('#8B5CF6', -0.12)),
  blue: same(paint('#3B82F6', -0.17)),
  orange: same(paint('#F97316', -0.15)),
  amber: same(paint('#F59E0B', -0.15, INK)),
  pink: same(paint('#EC4899', -0.17)),
  brown: same(paint('#92400E', 0.13)),
  gray: same(paint('#9CA3AF', -0.22, INK)),
  white: same(paint('#E5E7EB', -0.4, INK)),
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

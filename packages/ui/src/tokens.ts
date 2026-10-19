/*
 * Design tokens as plain values, mirroring tokens.css (DESIGN.md sections 4-6).
 * No DOM access, so the React Native port can import this file as-is.
 * tokens.test.ts fails if these values drift from tokens.css.
 */

export const colorLight = {
  brand: '#2E7D5B',
  brandInk: '#18492F',
  sun: '#C8781E',
  live: '#D14A32',
  river: '#2E6E9E',
  paper: '#FBF7F0',
  surface: '#FFFFFF',
  surface2: '#F2ECE0',
  line: '#E7DDCB',
  ink: '#241F18',
  ink2: '#6A6153',
  danger: '#D14A32',
  warn: '#C8781E',
  ok: '#2E7D5B',
  info: '#2E6E9E',
} as const;

export const colorDark = {
  brand: '#4FB488',
  brandInk: '#BFEAD4',
  sun: '#E8A24A',
  live: '#F0633F',
  river: '#6FB1D8',
  paper: '#14110D',
  surface: '#1E1A14',
  surface2: '#272219',
  line: '#3A3227',
  ink: '#F3EEE2',
  ink2: '#B2A892',
  danger: '#F0633F',
  warn: '#E8A24A',
  ok: '#4FB488',
  info: '#6FB1D8',
} as const;

export const color = { light: colorLight, dark: colorDark } as const;

export const shadow = {
  light: {
    1: '0 1px 2px rgba(36, 31, 24, 0.06)',
    2: '0 1px 2px rgba(36, 31, 24, 0.06), 0 4px 12px rgba(36, 31, 24, 0.06)',
    3: '0 2px 4px rgba(36, 31, 24, 0.05), 0 12px 32px rgba(36, 31, 24, 0.1)',
  },
  dark: {
    1: '0 1px 2px rgba(0, 0, 0, 0.4)',
    2: '0 1px 2px rgba(0, 0, 0, 0.4), 0 4px 12px rgba(0, 0, 0, 0.3)',
    3: '0 2px 4px rgba(0, 0, 0, 0.35), 0 12px 32px rgba(0, 0, 0, 0.45)',
  },
} as const;

export const radius = { sm: 8, md: 12, lg: 18, xl: 28 } as const;

export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 6: 24, 8: 32, 12: 48, 16: 64 } as const;

export const fontFamily = {
  display: '"Fraunces Variable", Fraunces, Georgia, serif',
  ui: '"Inter Variable", Inter, system-ui, -apple-system, "Segoe UI", sans-serif',
  mono: '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
} as const;

export const fontSize = { xs: 12, base: 14, md: 16, lg: 19, xl: 23, '2xl': 28, '3xl': 37, '4xl': 50 } as const;

export const lineHeight = { body: 1.5, display: 1.15 } as const;

export const motion = { fast: 120, base: 200, easeOut: 'cubic-bezier(0.16, 1, 0.3, 1)' } as const;

export const tokens = { color, shadow, radius, space, fontFamily, fontSize, lineHeight, motion } as const;
export type Tokens = typeof tokens;
export type ThemeName = keyof typeof color;
export type ColorToken = keyof typeof colorLight;

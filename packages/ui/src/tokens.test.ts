import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AVATAR_COLORS,
  colorDark,
  colorLight,
  fontFamily,
  fontSize,
  lineHeight,
  motion,
  radius,
  shadow,
  space,
  tracking,
  type ColorToken,
} from './tokens';

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Extracts `selector -> { --name: value }` for every rule, including ones nested in @media. */
function parseBlocks(source: string): Map<string, Record<string, string>> {
  const blocks = new Map<string, Record<string, string>>();
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1]!.trim();
    const vars = blocks.get(selector) ?? {};
    for (const decl of match[2]!.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
      vars[decl[1]!] = decl[2]!.trim();
    }
    blocks.set(selector, vars);
  }
  return blocks;
}

const blocks = parseBlocks(css);
const light = blocks.get(':root') ?? {};
const darkMedia = blocks.get(':root:not([data-theme="light"])') ?? {};
const darkAttr = blocks.get(':root[data-theme="dark"]') ?? {};

const cssName = (key: string) => key.replace(/([a-z])([A-Z0-9])/g, '$1-$2').toLowerCase();

function expectColors(vars: Record<string, string>, expected: Record<string, string>) {
  for (const [key, value] of Object.entries(expected)) {
    expect(vars[cssName(key)]?.toLowerCase(), `--${cssName(key)}`).toBe(value.toLowerCase());
  }
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('tokens.css mirrors tokens.ts', () => {
  it('defines every light color on :root', () => {
    expectColors(light, colorLight);
  });

  it('defines every dark color under the media query and the data-theme attribute', () => {
    expect(Object.keys(darkMedia).length).toBeGreaterThan(0);
    expectColors(darkMedia, colorDark);
    expectColors(darkAttr, colorDark);
  });

  it('keeps the old brand palette out', () => {
    for (const name of ['brand', 'sun', 'live', 'river', 'paper']) {
      expect(light[name], `--${name}`).toBeUndefined();
    }
  });

  it('mirrors the avatar colors in both themes', () => {
    for (const [name, paint] of Object.entries(AVATAR_COLORS)) {
      expect(light[`avatar-${name}`]?.toLowerCase(), `--avatar-${name}`).toBe(paint.light.fill.toLowerCase());
      expect(light[`avatar-${name}-eye`]?.toLowerCase(), `--avatar-${name}-eye`).toBe(paint.light.eye.toLowerCase());
      for (const dark of [darkMedia, darkAttr]) {
        const fill = dark[`avatar-${name}`] ?? light[`avatar-${name}`];
        const eye = dark[`avatar-${name}-eye`] ?? light[`avatar-${name}-eye`];
        expect(fill?.toLowerCase(), `dark --avatar-${name}`).toBe(paint.dark.fill.toLowerCase());
        expect(eye?.toLowerCase(), `dark --avatar-${name}-eye`).toBe(paint.dark.eye.toLowerCase());
      }
    }
    expect(AVATAR_COLORS.black.dark).toEqual({ fill: '#F2F2F2', eye: '#111111' });
  });

  it('keeps radius, spacing, type, shadow, and motion values identical', () => {
    for (const [key, value] of Object.entries(radius)) {
      expect(light[`r-${key}`]).toBe(`${value}px`);
    }
    for (const [key, value] of Object.entries(space)) {
      expect(light[`space-${key}`]).toBe(`${value}px`);
    }
    for (const [key, value] of Object.entries(fontSize)) {
      expect(light[`fs-${key}`]).toBe(`${value}px`);
    }
    expect(light['lh-body']).toBe(String(lineHeight.body));
    expect(light['lh-heading']).toBe(String(lineHeight.heading));
    expect(light['tracking-heading']).toBe(tracking.heading);
    expect(light['tracking-tight']).toBe(tracking.tight);
    expect(light['dur-fast']).toBe(`${motion.fast}ms`);
    expect(light['dur-base']).toBe(`${motion.base}ms`);
    expect(light['ease']).toBe(motion.ease);
    expect(light['font-ui']).toBe(fontFamily.ui);
    expect(light['font-code']).toBe(fontFamily.code);
    expect(light['shadow-float']).toBe(shadow.float);
  });

  it('uses only Inter and JetBrains Mono, no serif', () => {
    expect(css).not.toMatch(/[^-]serif/);
    expect(fontFamily.ui.startsWith('"Inter Variable"')).toBe(true);
    expect(fontFamily.code.startsWith('"JetBrains Mono Variable"')).toBe(true);
  });
});

describe('contrast (WCAG 2.x)', () => {
  const themes = { light: colorLight, dark: colorDark };
  const pairs: Array<[ColorToken, ColorToken]> = [
    ['ink', 'bg'],
    ['ink', 'surface'],
    ['ink', 'surface2'],
    ['ink2', 'bg'],
    ['ink2', 'surface'],
    ['ink2', 'surface2'],
    ['ink3', 'bg'],
    ['ink3', 'surface'],
    ['ink3', 'surface2'],
    ['primaryInk', 'primary'],
    ['attentionText', 'bg'],
    ['attentionText', 'surface'],
    ['attentionText', 'attentionSoft'],
    ['ink', 'attentionSoft'],
    ['ink2', 'attentionSoft'],
  ];

  for (const [name, vars] of Object.entries(themes)) {
    it(`${name}: every text pair meets AA (4.5:1)`, () => {
      for (const [fg, bg] of pairs) {
        expect(contrast(vars[fg], vars[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`${name}: the attention outline and focus ring meet 3:1 against surfaces`, () => {
      for (const bg of ['bg', 'surface', 'attentionSoft'] as const) {
        expect(contrast(vars.attention, vars[bg]), `attention on ${bg}`).toBeGreaterThanOrEqual(3);
      }
      expect(contrast(vars.focus, vars.bg), 'focus on bg').toBeGreaterThanOrEqual(3);
    });
  }
});

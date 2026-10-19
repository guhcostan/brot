import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { colorDark, colorLight, fontFamily, fontSize, lineHeight, motion, radius, shadow, space } from './tokens';

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

  it('keeps radius, spacing, type, and motion values identical', () => {
    for (const [key, value] of Object.entries(radius)) {
      expect(light[`r-${key}`]).toBe(`${value}px`);
    }
    for (const [key, value] of Object.entries(space)) {
      expect(light[`space-${key}`]).toBe(`${value}px`);
    }
    for (const [key, value] of Object.entries(fontSize)) {
      expect(light[`text-${key}`]).toBe(`${value}px`);
    }
    expect(light['leading-body']).toBe(String(lineHeight.body));
    expect(light['leading-display']).toBe(String(lineHeight.display));
    expect(light['motion-fast']).toBe(`${motion.fast}ms`);
    expect(light['motion-base']).toBe(`${motion.base}ms`);
    expect(light['ease-out']).toBe(motion.easeOut);
    expect(light['font-display']).toBe(fontFamily.display);
    expect(light['font-ui']).toBe(fontFamily.ui);
    expect(light['font-mono']).toBe(fontFamily.mono);
  });

  it('keeps shadow values identical in both themes', () => {
    expect(light['shadow-1']).toBe(shadow.light[1]);
    expect(light['shadow-3']).toBe(shadow.light[3]);
    expect(darkAttr['shadow-2']).toBe(shadow.dark[2]);
    expect(darkMedia['shadow-3']).toBe(shadow.dark[3]);
  });
});

describe('contrast (WCAG 2.x)', () => {
  const themes = {
    light: { vars: colorLight, bgs: ['paper', 'surface', 'surface2'] as const },
    dark: { vars: colorDark, bgs: ['paper', 'surface', 'surface2'] as const },
  };

  for (const [name, theme] of Object.entries(themes)) {
    it(`${name}: body text meets AA (4.5:1) on every surface`, () => {
      for (const bg of theme.bgs) {
        expect(contrast(theme.vars.ink, theme.vars[bg]), `ink on ${bg}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(theme.vars.ink2, theme.vars[bg]), `ink-2 on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(theme.vars.brand, theme.vars.paper), 'brand on paper').toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.vars.surface, theme.vars.brand), 'primary button text').toBeGreaterThanOrEqual(4.5);
    });

    it(`${name}: borders and the approval outline meet 3:1 against surfaces`, () => {
      expect(contrast(theme.vars.ink2, theme.vars.surface), 'input border').toBeGreaterThanOrEqual(3);
      expect(contrast(theme.vars.live, theme.vars.surface), 'approval border').toBeGreaterThanOrEqual(3);
    });
  }
});

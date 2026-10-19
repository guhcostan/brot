import type { CSSProperties, ReactElement } from 'react';

/**
 * The eight fauna mascots from DESIGN.md section 2. One construction for the whole set: a 64-unit
 * viewBox, a 2-unit outline in --ink, round caps, the same eye style, and rounded geometric shapes.
 * Fills are color-mix() blends of existing tokens, so no ad-hoc colors and dark mode comes for free.
 */

export const FAUNA_KINDS = [
  'capybara',
  'jaguar',
  'toucan',
  'macaw',
  'anteater',
  'boto',
  'sloth',
  'marmoset',
] as const;

export type FaunaKind = (typeof FAUNA_KINDS)[number];

export const FAUNA_LABELS: Record<FaunaKind, string> = {
  capybara: 'Capybara',
  jaguar: 'Jaguar',
  toucan: 'Toucan',
  macaw: 'Macaw',
  anteater: 'Anteater',
  boto: 'Pink river dolphin',
  sloth: 'Sloth',
  marmoset: 'Marmoset',
};

export function isFaunaKind(value: unknown): value is FaunaKind {
  return typeof value === 'string' && (FAUNA_KINDS as readonly string[]).includes(value);
}

const INK = 'var(--ink)';
const PAPER = 'var(--paper)';
const tint = (token: string, percent: number): string =>
  `color-mix(in srgb, var(${token}) ${percent}%, var(--paper))`;
const shape = (fill: string): CSSProperties => ({ fill, stroke: INK });
const dot: CSSProperties = { fill: INK, stroke: 'none' };
const outline: CSSProperties = { fill: 'none', stroke: INK };

function Eye({ x, y, r = 2.6 }: { x: number; y: number; r?: number }): ReactElement {
  return (
    <g>
      <circle cx={x} cy={y} r={r} style={dot} />
      <circle cx={x + r * 0.35} cy={y - r * 0.35} r={r * 0.32} style={{ fill: PAPER, stroke: 'none' }} />
    </g>
  );
}

const faces: Record<FaunaKind, () => ReactElement> = {
  capybara: () => (
    <>
      <circle cx="15" cy="17" r="5.5" style={shape(tint('--sun', 70))} />
      <circle cx="49" cy="17" r="5.5" style={shape(tint('--sun', 70))} />
      <rect x="7" y="12" width="50" height="42" rx="21" style={shape(tint('--sun', 60))} />
      <rect x="17" y="37" width="30" height="17" rx="8.5" style={shape(tint('--sun', 30))} />
      <path d="M21 26.5 Q24.5 28.6 28 26.5 M36 26.5 Q39.5 28.6 43 26.5" style={outline} />
      <Eye x={24.5} y={29.5} r={2.3} />
      <Eye x={39.5} y={29.5} r={2.3} />
      <circle cx="28.5" cy="44" r="1.3" style={dot} />
      <circle cx="35.5" cy="44" r="1.3" style={dot} />
    </>
  ),
  jaguar: () => (
    <>
      <circle cx="15" cy="15" r="6" style={shape('var(--sun)')} />
      <circle cx="49" cy="15" r="6" style={shape('var(--sun)')} />
      <ellipse cx="32" cy="34" rx="23" ry="21" style={shape('var(--sun)')} />
      <ellipse cx="32" cy="45" rx="11" ry="8" style={shape(PAPER)} />
      <circle cx="12" cy="36" r="2" style={dot} />
      <circle cx="52" cy="36" r="2" style={dot} />
      <circle cx="18" cy="50" r="1.8" style={dot} />
      <circle cx="46" cy="50" r="1.8" style={dot} />
      <path d="M16 24 L26 27 M48 24 L38 27" style={outline} />
      <Eye x={23} y={31} r={3} />
      <Eye x={41} y={31} r={3} />
      <path d="M29 41 L35 41 L32 44 Z" style={shape(INK)} />
      <path d="M32 44 Q29.5 48 26 46 M32 44 Q34.5 48 38 46" style={outline} />
    </>
  ),
  toucan: () => (
    <>
      <circle cx="28" cy="36" r="19" style={shape(INK)} />
      <ellipse cx="26" cy="50" rx="10" ry="6" style={shape(PAPER)} />
      <circle cx="22" cy="31" r="5.2" style={shape('var(--river)')} />
      <Eye x={22} y={31} r={2.6} />
      <path d="M42 28 Q60 22 60 34 Q57 46 43 40 Z" style={shape('var(--sun)')} />
      <path d="M45 34 Q52 33 58 35" style={outline} />
    </>
  ),
  macaw: () => (
    <>
      <path d="M20 20 L22 6 L28 16 L32 4 L36 16 L42 8 L44 20 Z" style={shape('var(--sun)')} />
      <circle cx="30" cy="34" r="19" style={shape('var(--live)')} />
      <ellipse cx="37" cy="30" rx="8" ry="7" style={shape(PAPER)} />
      <ellipse cx="22" cy="42" rx="9" ry="6" transform="rotate(-25 22 42)" style={shape('var(--river)')} />
      <Eye x={38} y={29.5} r={2.6} />
      <path d="M44 36 Q56 30 54 42 Q52 50 45 46 Z" style={shape(INK)} />
    </>
  ),
  anteater: () => (
    <>
      <ellipse cx="16" cy="18" rx="5" ry="8" transform="rotate(-20 16 18)" style={shape(tint('--ink-2', 55))} />
      <ellipse cx="26" cy="32" rx="17" ry="15" style={shape(tint('--ink-2', 55))} />
      <rect x="34" y="28" width="26" height="12" rx="6" transform="rotate(14 34 34)" style={shape(tint('--ink-2', 55))} />
      <path d="M12 28 Q22 22 32 27" style={outline} />
      <Eye x={20} y={30} r={2.6} />
      <circle cx="60" cy="40" r="2" style={dot} />
    </>
  ),
  boto: () => (
    <>
      <path d="M26 20 Q32 6 40 16 Z" style={shape(tint('--live', 45))} />
      <circle cx="30" cy="36" r="18" style={shape(tint('--live', 45))} />
      <rect x="38" y="32" width="20" height="10" rx="5" style={shape(tint('--live', 45))} />
      <Eye x={28} y={32} r={2.6} />
      <path d="M42 42 Q46 44 52 41" style={outline} />
    </>
  ),
  sloth: () => (
    <>
      <circle cx="10" cy="32" r="3.5" style={shape(tint('--ink-2', 40))} />
      <circle cx="54" cy="32" r="3.5" style={shape(tint('--ink-2', 40))} />
      <circle cx="32" cy="34" r="22" style={shape(tint('--ink-2', 40))} />
      <ellipse cx="32" cy="39" rx="15" ry="12" style={shape(PAPER)} />
      <ellipse cx="23" cy="30" rx="7" ry="5.5" style={dot} />
      <ellipse cx="41" cy="30" rx="7" ry="5.5" style={dot} />
      <circle cx="24.5" cy="28.5" r="1.4" style={{ fill: PAPER, stroke: 'none' }} />
      <circle cx="42.5" cy="28.5" r="1.4" style={{ fill: PAPER, stroke: 'none' }} />
      <path d="M29 42 Q32 40 35 42 M27 47 Q32 50 37 47" style={outline} />
    </>
  ),
  marmoset: () => (
    <>
      <path d="M16 22 Q8 8 18 4 Q22 12 24 20 Z" style={shape(tint('--sun', 55))} />
      <path d="M48 22 Q56 8 46 4 Q42 12 40 20 Z" style={shape(tint('--sun', 55))} />
      <circle cx="32" cy="36" r="19" style={shape(tint('--sun', 55))} />
      <ellipse cx="32" cy="41" rx="12" ry="10" style={shape(PAPER)} />
      <Eye x={25} y={34} r={4} />
      <Eye x={39} y={34} r={4} />
      <circle cx="32" cy="41" r="1.6" style={dot} />
      <path d="M28.5 46 Q32 48.5 35.5 46" style={outline} />
    </>
  ),
};

export interface FaunaProps {
  kind: FaunaKind;
  size?: number;
  /** Accessible name. Omit for decorative use (the animal is then hidden from assistive tech). */
  label?: string;
  className?: string;
}

export function Fauna({ kind, size = 48, label, className }: FaunaProps): ReactElement {
  const Face = faces[kind];
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Face />
    </svg>
  );
}

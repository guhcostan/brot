import type { ColorToken } from '@brot/ui/tokens';
import type { ReactElement } from 'react';
import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';
import { FONT, letterSpacing, lineHeightFor } from '../theme/theme';
import { useTheme } from '../theme/ThemeProvider';
import { fontSize } from '@brot/ui/tokens';

/** The type scale from DESIGN.md section 5, sized for a phone: chat body is 16. */
export const TEXT_VARIANTS = {
  display: { fontFamily: FONT.semibold, fontSize: fontSize['2xl'], lineHeight: lineHeightFor(fontSize['2xl'], 'heading'), letterSpacing: letterSpacing('tight', fontSize['2xl']) },
  title: { fontFamily: FONT.semibold, fontSize: fontSize.xl, lineHeight: lineHeightFor(fontSize.xl, 'heading'), letterSpacing: letterSpacing('heading', fontSize.xl) },
  heading: { fontFamily: FONT.semibold, fontSize: fontSize.lg, lineHeight: lineHeightFor(fontSize.lg, 'heading'), letterSpacing: letterSpacing('heading', fontSize.lg) },
  subheading: { fontFamily: FONT.semibold, fontSize: fontSize.md, lineHeight: lineHeightFor(fontSize.md, 'heading') + 2, letterSpacing: letterSpacing('heading', fontSize.md) },
  body: { fontFamily: FONT.regular, fontSize: fontSize.md, lineHeight: lineHeightFor(fontSize.md) },
  bodyStrong: { fontFamily: FONT.medium, fontSize: fontSize.md, lineHeight: lineHeightFor(fontSize.md) },
  small: { fontFamily: FONT.regular, fontSize: fontSize.base, lineHeight: lineHeightFor(fontSize.base) },
  label: { fontFamily: FONT.medium, fontSize: fontSize.base, lineHeight: lineHeightFor(fontSize.base) },
  meta: { fontFamily: FONT.regular, fontSize: fontSize.sm, lineHeight: lineHeightFor(fontSize.sm) },
  caption: { fontFamily: FONT.medium, fontSize: fontSize.xs, lineHeight: lineHeightFor(fontSize.xs) },
  mono: { fontFamily: FONT.mono, fontSize: fontSize.sm, lineHeight: lineHeightFor(fontSize.sm) },
  monoSmall: { fontFamily: FONT.mono, fontSize: fontSize.xs, lineHeight: lineHeightFor(fontSize.xs) },
} satisfies Record<string, TextStyle>;

export type TextVariant = keyof typeof TEXT_VARIANTS;

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  tone?: ColorToken;
  /** Tabular figures for times and counts. */
  numeric?: boolean;
}

export function Text({ variant = 'body', tone = 'ink', numeric, style, ...rest }: TextProps): ReactElement {
  const theme = useTheme();
  return (
    <RNText
      {...rest}
      style={[
        TEXT_VARIANTS[variant],
        { color: theme.color[tone] },
        numeric ? { fontVariant: ['tabular-nums'] } : null,
        style,
      ]}
    />
  );
}

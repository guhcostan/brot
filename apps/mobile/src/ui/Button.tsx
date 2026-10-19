import type { ColorToken } from '@brot/ui/tokens';
import type { ReactElement } from 'react';
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Icon, type IconName } from './Icon';
import { PressScale } from './Pressable';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
  icon?: IconName;
  disabled?: boolean;
  busy?: boolean;
  /** Spoken instead of the label, when the label alone is ambiguous. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}

/** DESIGN.md section 6: primary is the black fill, danger is the attention outline used only for Deny and Stop. */
export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  disabled = false,
  busy = false,
  accessibilityLabel,
  accessibilityHint,
  style,
}: ButtonProps): ReactElement {
  const theme = useTheme();
  const c = theme.color;
  const inert = disabled || busy;

  const surface: Record<ButtonVariant, ViewStyle> = {
    primary: { backgroundColor: c.primary, borderColor: c.primary },
    secondary: { backgroundColor: c.surface2, borderColor: c.surface2 },
    ghost: { backgroundColor: 'transparent', borderColor: 'transparent' },
    danger: { backgroundColor: 'transparent', borderColor: c.attention },
  };
  const ink: Record<ButtonVariant, ColorToken> = {
    primary: 'primaryInk',
    secondary: 'ink',
    ghost: 'ink',
    danger: 'attentionText',
  };

  return (
    <PressScale
      onPress={onPress}
      disabled={inert}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inert, busy }}
      hitSlop={size === 'sm' ? 4 : 0}
      style={[
        styles.base,
        { borderRadius: theme.radius.md, paddingHorizontal: size === 'sm' ? theme.space[3] : theme.space[4] },
        size === 'sm' ? styles.sm : styles.md,
        surface[variant],
        inert && !busy ? styles.disabled : null,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={c[ink[variant]]} />
      ) : (
        <View style={styles.row}>
          {icon ? <Icon name={icon} size={size === 'sm' ? 16 : 18} tone={ink[variant]} /> : null}
          <Text variant="label" tone={ink[variant]} numberOfLines={1}>
            {label}
          </Text>
        </View>
      )}
    </PressScale>
  );
}

const styles = StyleSheet.create({
  base: { borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  md: { minHeight: 48 },
  sm: { minHeight: 40 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  disabled: { opacity: 0.4 },
});

import { useState, type ReactElement } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { FONT } from '../theme/theme';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export interface FieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  hint?: string;
  error?: string;
  mono?: boolean;
}

/** Label above a --surface-2 input with a --focus border while editing (DESIGN.md sections 6 and 9). */
export function Field({ label, hint, error, mono, onFocus, onBlur, ...rest }: FieldProps): ReactElement {
  const theme = useTheme();
  const c = theme.color;
  const [focused, setFocused] = useState(false);

  return (
    <View style={{ gap: theme.space[2] }}>
      <Text variant="label" tone="ink">
        {label}
      </Text>
      <TextInput
        placeholderTextColor={c.ink3}
        selectionColor={c.ink}
        accessibilityLabel={label}
        accessibilityHint={error ?? hint}
        {...rest}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        style={[
          styles.input,
          {
            borderRadius: theme.radius.md,
            backgroundColor: c.surface2,
            borderColor: error ? c.attention : focused ? c.focus : c.surface2,
            color: c.ink,
            paddingHorizontal: theme.space[3],
            fontFamily: mono ? FONT.mono : FONT.regular,
            fontSize: mono ? theme.fontSize.base : theme.fontSize.md,
          },
          rest.multiline ? styles.multiline : null,
        ]}
      />
      {error ? (
        <Text variant="meta" tone="attentionText" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="meta" tone="ink2">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  input: { minHeight: 48, borderWidth: 1.5, paddingVertical: 12 },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
});

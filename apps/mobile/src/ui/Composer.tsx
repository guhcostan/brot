import { useState, type ReactElement } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { FONT } from '../theme/theme';
import { useTheme } from '../theme/ThemeProvider';
import { Icon } from './Icon';
import { PressScale } from './Pressable';

export interface ComposerProps {
  placeholder: string;
  onSend: (text: string) => Promise<void>;
  /** Shown instead of send while a run is working, when this phone may stop it. */
  onStop?: () => void;
  disabled?: boolean;
}

const MAX_HEIGHT = 140;
const BUTTON = 36;

/** DESIGN.md section 7: a single rounded field with a black circular send button. */
export function Composer({ placeholder, onSend, onStop, disabled = false }: ComposerProps): ReactElement {
  const theme = useTheme();
  const c = theme.color;
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const canSend = text.trim().length > 0 && !sending && !disabled;

  const send = async () => {
    if (!canSend) return;
    const value = text;
    setText('');
    setSending(true);
    try {
      await onSend(value);
    } catch {
      setText(value);
    } finally {
      setSending(false);
    }
  };

  return (
    <View
      style={[
        styles.box,
        {
          borderRadius: theme.radius.xl,
          backgroundColor: c.surface,
          borderColor: c.line,
          paddingLeft: theme.space[4],
          paddingRight: theme.space[1] + 2,
          boxShadow: theme.floatShadow,
        },
      ]}
    >
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={placeholder}
        placeholderTextColor={c.ink3}
        selectionColor={c.ink}
        multiline
        editable={!disabled}
        accessibilityLabel="Message"
        style={[styles.input, { color: c.ink, fontFamily: FONT.regular, fontSize: theme.fontSize.md }]}
      />
      {onStop && !canSend ? (
        <PressScale
          onPress={onStop}
          accessibilityRole="button"
          accessibilityLabel="Stop the run"
          style={[styles.button, { borderColor: c.ink, borderWidth: 1.5, backgroundColor: 'transparent' }]}
        >
          <Icon name="stop" size={18} tone="ink" />
        </PressScale>
      ) : (
        <PressScale
          onPress={() => void send()}
          disabled={!canSend}
          accessibilityRole="button"
          accessibilityLabel="Send"
          accessibilityState={{ disabled: !canSend, busy: sending }}
          pressedScale={0.9}
          style={[styles.button, { backgroundColor: c.primary, opacity: canSend ? 1 : 0.3 }]}
        >
          <Icon name="arrowUp" size={18} tone="primaryInk" strokeWidth={2.25} />
        </PressScale>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'flex-end', borderWidth: 1, minHeight: 48, paddingVertical: 5 },
  input: { flex: 1, maxHeight: MAX_HEIGHT, paddingTop: 8, paddingBottom: 8, paddingRight: 8 },
  button: { width: BUTTON, height: BUTTON, borderRadius: BUTTON / 2, alignItems: 'center', justifyContent: 'center' },
});

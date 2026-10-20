import type { ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { botStatusLabel, type BotStatus } from '../state/inbox';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export interface StatusDotProps {
  status: BotStatus;
  /** Overrides the default label, e.g. "Sleeping · last seen 14:02". */
  label?: string;
}

/** Matches the web StatusDot: ink tones for every status, attention only for waiting and error, always with text. */
export function StatusDot({ status, label }: StatusDotProps): ReactElement {
  const theme = useTheme();
  const c = theme.color;
  const urgent = status === 'waiting' || status === 'error';
  const hollow = status === 'idle' || status === 'sleeping';
  const dot = hollow
    ? { borderWidth: 1.5, borderColor: c.ink3, backgroundColor: 'transparent' }
    : { backgroundColor: urgent ? c.attention : status === 'ok' ? c.ink : c.ink2 };

  return (
    <View style={styles.row}>
      <View style={[styles.dot, dot]} />
      <Text variant="caption" tone={urgent ? 'attentionText' : 'ink2'} numberOfLines={1}>
        {label ?? botStatusLabel(status)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3 },
});

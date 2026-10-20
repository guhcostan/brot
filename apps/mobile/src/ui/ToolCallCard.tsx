import { useState, type ReactElement } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';
import { prettyJson } from '../format';
import { t } from '../i18n';
import type { ToolCall } from '../state/thread';
import { riseIn } from '../theme/motion';
import { useTheme } from '../theme/ThemeProvider';
import { Icon } from './Icon';
import { Text } from './Text';

const OUTPUT_LIMIT = 4000;

function clip(text: string): string {
  return text.length > OUTPUT_LIMIT ? `${text.slice(0, OUTPUT_LIMIT)}\n…` : text;
}

function CodeBlock({ label, text }: { label: string; text: string }): ReactElement {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space[1] }}>
      <Text variant="caption" tone="ink2">
        {label}
      </Text>
      <View style={{ backgroundColor: theme.color.surface2, borderRadius: theme.radius.sm, paddingHorizontal: theme.space[3], paddingVertical: theme.space[2] }}>
        <Text variant="monoSmall" selectable>
          {text}
        </Text>
      </View>
    </View>
  );
}

/** A collapsed mono line per tool call; tapping shows the arguments and output. */
export function ToolCallCard({ call }: { call: ToolCall }): ReactElement {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  const state = call.result ? (call.result.ok ? t('tool.done') : t('tool.failed')) : t('tool.running');

  return (
    <View style={[styles.card, { borderColor: theme.color.line, backgroundColor: theme.color.surface, borderRadius: theme.radius.md }]}>
      <Pressable
        onPress={() => setOpen((value) => !value)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={t('tool.call', { tool: call.tool, state })}
        style={({ pressed }) => [styles.summary, { paddingHorizontal: theme.space[3], gap: theme.space[2] }, pressed ? { backgroundColor: theme.color.surface2 } : null]}
      >
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} tone="ink3" />
        <Text variant="mono" numberOfLines={1} style={styles.name}>
          {call.tool}
        </Text>
        <Text variant="caption" tone={call.result && !call.result.ok ? 'ink' : 'ink3'}>
          {state}
        </Text>
      </Pressable>
      {open ? (
        <Animated.View entering={riseIn(reduced, 4)} style={{ paddingHorizontal: theme.space[3], paddingBottom: theme.space[3], gap: theme.space[2] }}>
          <CodeBlock label={t('tool.arguments')} text={prettyJson(call.args)} />
          {call.result ? <CodeBlock label={call.result.ok ? t('tool.output') : t('tool.error')} text={clip(call.result.output || t('tool.empty'))} /> : null}
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, overflow: 'hidden' },
  summary: { minHeight: 40, flexDirection: 'row', alignItems: 'center' },
  name: { flex: 1, minWidth: 0 },
});

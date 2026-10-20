import type { Bot } from '@brot/protocol';
import * as Haptics from 'expo-haptics';
import { useState, type ReactElement } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';
import { BotFace } from '../avatar/BotFace';
import { t } from '../i18n';
import { activeMention, findMentions, insertMention, matchMembers } from '../state/mentions';
import { riseIn } from '../theme/motion';
import { FONT } from '../theme/theme';
import { useTheme } from '../theme/ThemeProvider';
import { Icon } from './Icon';
import { PressScale } from './Pressable';
import { Text } from './Text';

export interface ComposerProps {
  placeholder: string;
  /** `mentions` are the ids of members named as @Name, in order (rooms only). */
  onSend: (text: string, mentions: string[]) => Promise<void>;
  /** Shown instead of send while a run is working, when this phone may stop it. */
  onStop?: () => void;
  disabled?: boolean;
  /** Bots that can be @mentioned. Typing "@" opens a picker above the field. */
  mentionables?: Bot[];
}

const MAX_HEIGHT = 140;
const BUTTON = 36;
const MAX_SUGGESTIONS = 5;

function MentionPicker({ bots, onPick }: { bots: Bot[]; onPick: (bot: Bot) => void }): ReactElement {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const c = theme.color;
  return (
    <Animated.View
      entering={riseIn(reduced, 4)}
      accessibilityRole="menu"
      accessibilityLabel={t('mention.suggestions')}
      style={[
        styles.picker,
        { borderRadius: theme.radius.lg, borderColor: c.line, backgroundColor: c.surface, boxShadow: theme.floatShadow, paddingVertical: theme.space[1] },
      ]}
    >
      {bots.map((bot) => (
        <Pressable
          key={bot.id}
          onPress={() => onPick(bot)}
          accessibilityRole="menuitem"
          accessibilityLabel={t('mention.pick', { name: bot.name })}
          style={({ pressed }) => [
            styles.option,
            { gap: theme.space[3], paddingHorizontal: theme.space[3], backgroundColor: pressed ? c.surface2 : 'transparent' },
          ]}
        >
          <BotFace bot={bot} botId={bot.id} size="sm" animated={false} />
          <View style={styles.flex}>
            <Text variant="label" numberOfLines={1}>
              {bot.name}
            </Text>
            <Text variant="meta" tone="ink2" numberOfLines={1}>
              {bot.job}
            </Text>
          </View>
        </Pressable>
      ))}
    </Animated.View>
  );
}

/** DESIGN.md section 7: a single rounded field with a black circular send button. */
export function Composer({ placeholder, onSend, onStop, disabled = false, mentionables }: ComposerProps): ReactElement {
  const theme = useTheme();
  const c = theme.color;
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const [selection, setSelection] = useState<{ start: number; end: number }>();
  const [sending, setSending] = useState(false);
  const canSend = text.trim().length > 0 && !sending && !disabled;

  const mention = mentionables && mentionables.length > 0 ? activeMention(text, caret) : null;
  const suggestions = mention && mentionables ? matchMembers(mentionables, mention.query).slice(0, MAX_SUGGESTIONS) : [];

  const pick = (bot: Bot) => {
    if (!mention) return;
    const next = insertMention(text, mention, bot.name);
    void Haptics.selectionAsync();
    setText(next.text);
    setCaret(next.caret);
    setSelection({ start: next.caret, end: next.caret });
  };

  const send = async () => {
    if (!canSend) return;
    const value = text;
    const mentions = mentionables ? findMentions(value, mentionables) : [];
    setText('');
    setCaret(0);
    setSending(true);
    try {
      await onSend(value, mentions);
    } catch {
      setText(value);
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={{ gap: theme.space[2] }}>
      {suggestions.length > 0 ? <MentionPicker bots={suggestions} onPick={pick} /> : null}
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
          onChangeText={(value) => {
            setText(value);
            setSelection(undefined);
          }}
          onSelectionChange={(event) => {
            setCaret(event.nativeEvent.selection.end);
            setSelection(undefined);
          }}
          selection={selection}
          placeholder={placeholder}
          placeholderTextColor={c.ink3}
          selectionColor={c.ink}
          multiline
          editable={!disabled}
          accessibilityLabel={t('composer.message')}
          style={[styles.input, { color: c.ink, fontFamily: FONT.regular, fontSize: theme.fontSize.md }]}
        />
        {onStop && !canSend ? (
          <PressScale
            onPress={onStop}
            accessibilityRole="button"
            accessibilityLabel={t('composer.stop')}
            style={[styles.button, { borderColor: c.attention, borderWidth: 1.5, backgroundColor: 'transparent' }]}
          >
            <Icon name="stop" size={18} tone="attentionText" />
          </PressScale>
        ) : (
          <PressScale
            onPress={() => void send()}
            disabled={!canSend}
            accessibilityRole="button"
            accessibilityLabel={t('composer.send')}
            accessibilityState={{ disabled: !canSend, busy: sending }}
            pressedScale={0.9}
            style={[styles.button, { backgroundColor: c.primary, opacity: canSend ? 1 : 0.3 }]}
          >
            <Icon name="arrowUp" size={18} tone="primaryInk" strokeWidth={2.25} />
          </PressScale>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  box: { flexDirection: 'row', alignItems: 'flex-end', borderWidth: 1, minHeight: 48, paddingVertical: 5 },
  input: { flex: 1, maxHeight: MAX_HEIGHT, paddingTop: 8, paddingBottom: 8, paddingRight: 8 },
  button: { width: BUTTON, height: BUTTON, borderRadius: BUTTON / 2, alignItems: 'center', justifyContent: 'center' },
  picker: { borderWidth: 1, overflow: 'hidden' },
  option: { flexDirection: 'row', alignItems: 'center', minHeight: 48 },
});

import type { ComputerInput, Takeover } from '@brot/protocol';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useState, type ReactElement } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BotFace } from '../../src/avatar/BotFace';
import { describeActivity } from '../../src/computer/activity';
import { LiveScreen } from '../../src/computer/LiveScreen';
import { useComputer } from '../../src/computer/useComputer';
import { describeError, usePaired } from '../../src/core/BrotProvider';
import { t } from '../../src/i18n';
import { riseIn } from '../../src/theme/motion';
import { FONT } from '../../src/theme/theme';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Button } from '../../src/ui/Button';
import { Icon } from '../../src/ui/Icon';
import { PressScale } from '../../src/ui/Pressable';
import { IconButton, Screen } from '../../src/ui/Screen';
import { Text } from '../../src/ui/Text';
import { useLocale } from '../../src/i18n/useLocale';

function newer(a: Takeover | null | undefined, b: Takeover | null | undefined): Takeover | undefined {
  if (!a) return b ?? undefined;
  if (!b) return a;
  return Date.parse(a.at) >= Date.parse(b.at) ? a : b;
}

function TypeBar({ onSend }: { onSend: (text: string) => Promise<void> }): ReactElement {
  const theme = useTheme();
  const c = theme.color;
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const canSend = text.length > 0 && !busy;
  const send = async () => {
    if (!canSend) return;
    setBusy(true);
    try {
      await onSend(text);
      setText('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ gap: theme.space[1] }}>
      <View style={[styles.typeBox, { borderRadius: theme.radius.xl, borderColor: c.line, backgroundColor: c.surface, paddingLeft: theme.space[4], paddingRight: theme.space[1] + 2 }]}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={t('computer.typePlaceholder')}
          placeholderTextColor={c.ink3}
          selectionColor={c.ink}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="send"
          onSubmitEditing={() => void send()}
          submitBehavior="submit"
          accessibilityLabel={t('computer.typePlaceholder')}
          accessibilityHint={t('computer.typeHint')}
          style={[styles.typeInput, { color: c.ink, fontFamily: FONT.mono, fontSize: theme.fontSize.base }]}
        />
        <PressScale
          onPress={() => void send()}
          disabled={!canSend}
          accessibilityRole="button"
          accessibilityLabel={t('computer.typeSend')}
          accessibilityState={{ disabled: !canSend, busy }}
          pressedScale={0.9}
          style={[styles.typeButton, { backgroundColor: c.primary, opacity: canSend ? 1 : 0.3 }]}
        >
          {busy ? <ActivityIndicator size="small" color={c.primaryInk} /> : <Icon name="enter" size={18} tone="primaryInk" strokeWidth={2.25} />}
        </PressScale>
      </View>
      <Text variant="meta" tone="ink3" style={{ paddingHorizontal: theme.space[2] }}>
        {t('computer.typeHint')}
      </Text>
    </View>
  );
}

export default function ComputerScreen(): ReactElement | null {
  useLocale();
  const { botId: rawBotId } = useLocalSearchParams<{ botId: string }>();
  const botId = String(rawBotId);
  const paired = usePaired();
  const theme = useTheme();
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const computer = useComputer(botId);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();

  if (!paired) return null;
  const bot = paired.inbox.bots.find((candidate) => candidate.id === botId);
  const name = bot?.name ?? t('common.bot');
  const takeover = newer(paired.inbox.takeovers[botId], computer.info?.takeover);
  const controlling = takeover?.active === true;
  const askedByBot = controlling && takeover?.requestedBy === 'bot';
  const canTakeOver = paired.capabilities.takeover;
  const activity = paired.inbox.computerActivity[botId];
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const toggle = async () => {
    setBusy(true);
    setFailure(undefined);
    try {
      await paired.setTakeover(botId, !controlling);
      void Haptics.notificationAsync(controlling ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning);
    } catch (cause) {
      setFailure(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  const input = async (payload: ComputerInput) => {
    try {
      await paired.client.sendInput(botId, payload);
    } catch (cause) {
      setFailure(describeError(cause));
      throw cause;
    }
  };

  const status: string = (() => {
    if (computer.status === 'none' || computer.info?.desktop === false) return t('computer.noDesktop');
    if (computer.info?.state === 'starting') return t('computer.starting');
    if (computer.info?.state === 'error') return t('computer.error');
    if (computer.status === 'stopped') return t('computer.stopped');
    if (computer.status === 'error') return computer.error ?? t('computer.unreachable');
    if (controlling) return askedByBot && takeover?.reason ? t('computer.needsYou', { name, reason: takeover.reason }) : t('computer.youHaveControl');
    if (activity) return describeActivity(activity.tool, activity.args);
    return computer.status === 'live' ? t('computer.botHasControl', { name }) : t('computer.loading');
  })();

  const placeholder = (() => {
    if (computer.status === 'none') return <Text tone="ink2">{t('computer.noDesktop')}</Text>;
    if (computer.status === 'stopped') {
      return (
        <View style={{ alignItems: 'center', gap: theme.space[3] }}>
          <Text tone="ink2">{computer.info?.state === 'starting' ? t('computer.starting') : t('computer.stopped')}</Text>
          {computer.info?.state !== 'starting' && canTakeOver ? <Button label={t('computer.start')} size="sm" variant="secondary" onPress={() => void computer.start()} /> : null}
        </View>
      );
    }
    if (computer.status === 'error') return <Text tone="ink2">{t('computer.unreachable')}</Text>;
    return <ActivityIndicator color={theme.color.ink3} />;
  })();

  return (
    <Screen>
      <View style={[styles.header, { paddingHorizontal: theme.space[2], borderBottomColor: theme.color.line }]}>
        <IconButton icon="close" label={t('common.close')} onPress={close} />
        <View style={[styles.headerCenter, { gap: theme.space[2] }]} accessible accessibilityRole="header" accessibilityLabel={t('computer.title', { name })}>
          <BotFace bot={bot} botId={botId} size="md" mood={askedByBot ? 'approval' : activity && !controlling ? 'thinking' : 'idle'} />
          <Text variant="label" numberOfLines={1} style={styles.shrink}>
            {t('computer.title', { name })}
          </Text>
        </View>
        <View style={styles.side}>
          <View style={[styles.liveDot, { backgroundColor: computer.status === 'live' ? theme.color.ink : theme.color.ink3 }]} />
          <Text variant="caption" tone="ink2">
            {computer.status === 'live' ? t('computer.live') : t('computer.paused')}
          </Text>
        </View>
      </View>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{ padding: theme.space[4], gap: theme.space[4], paddingBottom: Math.max(insets.bottom, theme.space[4]) + theme.space[4] }}
          keyboardShouldPersistTaps="handled"
          scrollEnabled
        >
          {askedByBot ? (
            <Animated.View
              entering={riseIn(reduced)}
              style={[styles.row, { gap: theme.space[2], padding: theme.space[3], borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.color.attention, backgroundColor: theme.color.attentionSoft }]}
              accessibilityLiveRegion="assertive"
            >
              <Icon name="alert" size={16} tone="attentionText" />
              <Text variant="small" tone="attentionText" style={styles.shrink}>
                {takeover?.reason ? t('computer.needsYou', { name, reason: takeover.reason }) : t('computer.needsYouNoReason', { name })}
              </Text>
            </Animated.View>
          ) : null}

          <LiveScreen
            uri={computer.frame}
            interactive={controlling && canTakeOver}
            onTap={(point) => {
              void Haptics.selectionAsync();
              void input({ type: 'click', x: point.x, y: point.y, button: 'left', double: false }).catch(() => undefined);
            }}
            accessibilityLabel={controlling && canTakeOver ? t('computer.screenTakeover') : t('computer.screen', { name })}
            placeholder={placeholder}
          />

          <View style={[styles.row, { gap: theme.space[2] }]} accessibilityLiveRegion="polite">
            <Icon name={controlling ? 'pointer' : 'monitor'} size={16} tone={controlling ? 'attentionText' : 'ink2'} />
            <Text variant="small" tone={controlling ? 'attentionText' : 'ink2'} style={styles.shrink} numberOfLines={2}>
              {status}
            </Text>
          </View>
          <Text variant="meta" tone="ink3">
            {t('computer.zoomHint')}
          </Text>

          {failure ? (
            <Text variant="small" tone="attentionText" accessibilityLiveRegion="assertive">
              {failure}
            </Text>
          ) : null}

          {canTakeOver ? (
            <>
              {controlling ? <TypeBar onSend={async (text) => {
                await input({ type: 'type', text });
                await input({ type: 'key', key: 'Return' });
              }} /> : null}
              <Button
                label={controlling ? t('computer.giveBack') : t('computer.takeControl')}
                variant={controlling ? 'secondary' : 'primary'}
                icon={controlling ? 'reply' : 'pointer'}
                busy={busy}
                disabled={computer.status === 'none' || computer.status === 'stopped'}
                onPress={() => void toggle()}
              />
            </>
          ) : (
            <View style={[styles.row, { gap: theme.space[2] }]}>
              <Icon name="lock" size={16} tone="ink2" />
              <Text variant="small" tone="ink2" style={styles.shrink}>
                {t('computer.viewOnly')}
              </Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  shrink: { flexShrink: 1, minWidth: 0 },
  row: { flexDirection: 'row', alignItems: 'center' },
  header: { minHeight: 52, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minWidth: 0 },
  side: { minWidth: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6, paddingRight: 8 },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  typeBox: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, minHeight: 48, paddingVertical: 5 },
  typeInput: { flex: 1, paddingVertical: 8, paddingRight: 8 },
  typeButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});

import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, type ReactElement } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BotFace } from '../../src/avatar/BotFace';
import { describeActivity } from '../../src/computer/activity';
import { hasDesktop, usePaired } from '../../src/core/BrotProvider';
import { useThread } from '../../src/core/useThread';
import { t } from '../../src/i18n';
import { STATUS_MOOD, botRows } from '../../src/state/inbox';
import { activeRun } from '../../src/state/thread';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Button } from '../../src/ui/Button';
import { Composer } from '../../src/ui/Composer';
import { Conversation } from '../../src/ui/Conversation';
import { Icon } from '../../src/ui/Icon';
import { Header, IconButton, Screen } from '../../src/ui/Screen';
import { StatusDot } from '../../src/ui/StatusDot';
import { TakeoverCard } from '../../src/ui/TakeoverCard';
import { Text } from '../../src/ui/Text';
import { useLocale } from '../../src/i18n/useLocale';

export default function ThreadScreen(): ReactElement | null {
  useLocale();
  const params = useLocalSearchParams<{ botId: string; threadId?: string }>();
  const botId = String(params.botId);
  const paired = usePaired();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const view = useThread({ botId, threadId: params.threadId ? String(params.threadId) : undefined });

  const row = useMemo(() => (paired ? botRows(paired.inbox).find((candidate) => candidate.bot.id === botId) : undefined), [paired, botId]);
  if (!paired) return null;
  const bot = row?.bot ?? paired.inbox.bots.find((candidate) => candidate.id === botId);
  const name = bot?.name ?? t('common.bot');
  const { capabilities } = paired;
  const run = view.state ? activeRun(view.state) : undefined;
  const status = row?.status ?? 'idle';
  const desktop = hasDesktop(bot);
  const takeover = paired.inbox.takeovers[botId];
  const askingForHelp = takeover?.active === true && takeover.requestedBy === 'bot';
  const activity = desktop ? paired.inbox.computerActivity[botId] : undefined;
  const openComputer = () => router.push({ pathname: '/computer/[botId]', params: { botId } });

  const empty = view.loading ? (
    <ActivityIndicator color={theme.color.ink3} />
  ) : view.error ? (
    <View style={{ gap: theme.space[4], alignItems: 'center' }}>
      <Text variant="body" tone="ink2" style={styles.center}>
        {view.error}
      </Text>
      <Button label={t('common.tryAgain')} variant="secondary" onPress={view.reload} />
    </View>
  ) : (
    <View style={{ gap: theme.space[4], alignItems: 'center' }}>
      <BotFace bot={bot} botId={botId} mood="idle" size="xl" />
      <Text variant="body" tone="ink2" style={styles.center}>
        {capabilities.chat ? t('thread.sayHi', { name }) : t('thread.noConversation', { name })}
      </Text>
    </View>
  );

  const footer = capabilities.chat ? (
    <View style={{ gap: theme.space[2] }}>
      {view.sendError ? (
        <Text variant="meta" tone="ink2" accessibilityLiveRegion="polite" style={{ paddingHorizontal: theme.space[2] }}>
          {t('thread.notSent', { error: view.sendError })}
        </Text>
      ) : null}
      <Composer
        placeholder={t('thread.message', { name })}
        onSend={(text) => view.send(text)}
        onStop={run && capabilities.cancel ? () => void view.cancel(run.id).catch(() => undefined) : undefined}
      />
    </View>
  ) : (
    <View style={[styles.readOnly, { gap: theme.space[2], paddingVertical: theme.space[3] }]}>
      <Icon name="lock" size={16} tone="ink3" />
      <Text variant="meta" tone="ink2">
        {paired.session.role === 'approver' ? t('thread.approverOnly') : t('thread.viewerOnly')}
      </Text>
    </View>
  );

  return (
    <Screen>
      <Header
        bordered
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        center={
          <View style={[styles.headerCenter, { gap: theme.space[2] }]} accessible accessibilityRole="header" accessibilityLabel={`${name}, ${row?.statusLabel ?? ''}`}>
            <BotFace bot={bot} botId={botId} mood={STATUS_MOOD[status]} size="md" />
            <View style={styles.headerText}>
              <Text variant="label" numberOfLines={1}>
                {name}
              </Text>
              <StatusDot status={status} label={activity && status === 'working' ? describeActivity(activity.tool, activity.args) : undefined} />
            </View>
          </View>
        }
        right={desktop ? <IconButton icon="monitor" label={t('thread.openComputer', { name })} onPress={openComputer} /> : undefined}
      />
      {askingForHelp && takeover ? (
        <View style={{ paddingHorizontal: theme.space[4], paddingTop: theme.space[3] }}>
          <TakeoverCard takeover={takeover} bot={bot} onPress={openComputer} />
        </View>
      ) : null}
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Conversation
          view={view}
          bots={paired.inbox.bots}
          defaultBotId={botId}
          room={false}
          canApprove={capabilities.approve}
          accessibilityLabel={t('thread.conversation', { name })}
          empty={empty}
        />
        <View style={{ paddingHorizontal: theme.space[3], paddingTop: theme.space[2], paddingBottom: Math.max(insets.bottom, theme.space[3]) }}>{footer}</View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  center: { textAlign: 'center' },
  readOnly: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flexDirection: 'row', alignItems: 'center' },
  headerText: { gap: 0, minWidth: 0, maxWidth: 200 },
});

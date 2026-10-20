import type { Bot } from '@brot/protocol';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, type ReactElement } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePaired } from '../../src/core/BrotProvider';
import { useThread } from '../../src/core/useThread';
import { t } from '../../src/i18n';
import { roomRows } from '../../src/state/inbox';
import { activeRun, batonHolder, typingBots } from '../../src/state/thread';
import { riseIn } from '../../src/theme/motion';
import { useTheme } from '../../src/theme/ThemeProvider';
import { AvatarStack } from '../../src/ui/AvatarStack';
import { Button } from '../../src/ui/Button';
import { Composer } from '../../src/ui/Composer';
import { Conversation } from '../../src/ui/Conversation';
import { Icon } from '../../src/ui/Icon';
import { Header, IconButton, Screen } from '../../src/ui/Screen';
import { TakeoverCard } from '../../src/ui/TakeoverCard';
import { Text } from '../../src/ui/Text';
import { useLocale } from '../../src/i18n/useLocale';

function BatonLine({ holder, lead }: { holder?: Bot; lead?: Bot }): ReactElement | null {
  const reduced = useReducedMotion();
  if (!holder && !lead) return null;
  const line = holder ? t('room.batonWith', { name: holder.name }) : t('room.lead', { name: lead?.name ?? '' });
  return (
    <Animated.View key={holder?.id ?? 'lead'} entering={riseIn(reduced, 4)} style={[styles.row, { gap: 4 }]}>
      <Icon name="baton" size={12} tone="ink2" />
      <Text variant="caption" tone="ink2" numberOfLines={1}>
        {line}
      </Text>
    </Animated.View>
  );
}

export default function RoomScreen(): ReactElement | null {
  useLocale();
  const params = useLocalSearchParams<{ threadId: string }>();
  const threadId = String(params.threadId);
  const paired = usePaired();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const view = useThread({ threadId });

  const row = useMemo(() => (paired ? roomRows(paired.inbox).find((candidate) => candidate.room.id === threadId) : undefined), [paired, threadId]);
  if (!paired) return null;
  const { capabilities, inbox } = paired;
  const room = row?.room;
  const members = row?.members ?? [];
  const leadId = room?.leadBotId ?? room?.botId ?? members[0]?.id ?? '';
  const lead = members.find((bot) => bot.id === leadId);
  const title = room?.title ?? t('room.title');
  const holderId = view.state ? batonHolder(view.state) : undefined;
  const holder = holderId ? inbox.bots.find((bot) => bot.id === holderId) : undefined;
  const working = view.state ? typingBots(view.state) : [];
  const run = view.state ? activeRun(view.state) : undefined;
  const help = Object.values(inbox.takeovers).find((takeover) => takeover.active && takeover.requestedBy === 'bot' && members.some((bot) => bot.id === takeover.botId));

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
      <AvatarStack bots={members} size={56} max={4} />
      <Text variant="body" tone="ink2" style={styles.center}>
        {t('room.empty')}
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
        placeholder={t('room.message')}
        mentionables={members}
        onSend={(text, mentions) => view.send(text, mentions)}
        onStop={run && capabilities.cancel ? () => void view.cancel(run.id).catch(() => undefined) : undefined}
      />
    </View>
  ) : (
    <View style={[styles.row, styles.centerRow, { gap: theme.space[2], paddingVertical: theme.space[3] }]}>
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
          <View
            style={[styles.row, { gap: theme.space[2] }]}
            accessible
            accessibilityRole="header"
            accessibilityLabel={`${title}. ${t('room.members', { names: members.map((bot) => bot.name).join(', ') })}`}
          >
            <AvatarStack bots={members} size={28} moodFor={(bot) => (working.includes(bot.id) ? 'thinking' : bot.id === holderId ? 'approval' : 'idle')} />
            <View style={styles.headerText}>
              <Text variant="label" numberOfLines={1}>
                {title}
              </Text>
              <BatonLine holder={holder} lead={lead} />
            </View>
          </View>
        }
        right={<IconButton icon="board" label={t('inbox.tasks')} onPress={() => router.push('/tasks')} tone="ink2" />}
      />
      {help ? (
        <View style={{ paddingHorizontal: theme.space[4], paddingTop: theme.space[3] }}>
          <TakeoverCard
            takeover={help}
            bot={inbox.bots.find((bot) => bot.id === help.botId)}
            onPress={() => router.push({ pathname: '/computer/[botId]', params: { botId: help.botId } })}
          />
        </View>
      ) : null}
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Conversation
          view={view}
          bots={inbox.bots}
          defaultBotId={leadId}
          room
          canApprove={capabilities.approve}
          accessibilityLabel={title}
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
  row: { flexDirection: 'row', alignItems: 'center' },
  centerRow: { justifyContent: 'center' },
  headerText: { minWidth: 0, maxWidth: 190 },
});

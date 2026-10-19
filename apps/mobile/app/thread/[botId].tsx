import { parseAvatar } from '@brot/ui/avatar';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, type ReactElement } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePaired } from '../../src/core/BrotProvider';
import { useThread, type OutgoingMessage } from '../../src/core/useThread';
import { BotAvatar } from '../../src/avatar/BotAvatar';
import { shortTime } from '../../src/format';
import { STATUS_MOOD, botRows } from '../../src/state/inbox';
import { activeRun, showTyping, timeline, type TimelineItem } from '../../src/state/thread';
import { riseIn } from '../../src/theme/motion';
import { useTheme } from '../../src/theme/ThemeProvider';
import { ApprovalCard } from '../../src/ui/ApprovalCard';
import { Button } from '../../src/ui/Button';
import { Composer } from '../../src/ui/Composer';
import { Icon } from '../../src/ui/Icon';
import { Header, Screen } from '../../src/ui/Screen';
import { StatusDot } from '../../src/ui/StatusDot';
import { Text } from '../../src/ui/Text';
import { ToolCallCard } from '../../src/ui/ToolCallCard';
import { TypingIndicator } from '../../src/ui/TypingIndicator';

type Row = TimelineItem | { kind: 'typing'; key: string } | { kind: 'outgoing'; key: string; outgoing: OutgoingMessage };

function UserBubble({ text, time, faded, note }: { text: string; time?: string; faded?: boolean; note?: string }): ReactElement {
  const theme = useTheme();
  return (
    <View style={[styles.userWrap, { gap: theme.space[1] }]}>
      <View
        style={[
          {
            backgroundColor: theme.color.surface2,
            borderRadius: theme.radius.xl,
            paddingHorizontal: theme.space[4],
            paddingVertical: theme.space[2] + 2,
            opacity: faded ? 0.6 : 1,
          },
        ]}
      >
        <Text variant="body" selectable>
          {text}
        </Text>
      </View>
      {note ? (
        <Text variant="caption" tone="ink2" accessibilityLiveRegion="polite">
          {note}
        </Text>
      ) : time ? (
        <Text variant="caption" tone="ink3" numeric>
          {time}
        </Text>
      ) : null}
    </View>
  );
}

function BotText({ text, time }: { text: string; time?: string }): ReactElement {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space[1] }}>
      <Text variant="body" selectable>
        {text}
      </Text>
      {time ? (
        <Text variant="caption" tone="ink3" numeric>
          {time}
        </Text>
      ) : null}
    </View>
  );
}

export default function ThreadScreen(): ReactElement | null {
  const params = useLocalSearchParams<{ botId: string; threadId?: string }>();
  const botId = String(params.botId);
  const paired = usePaired();
  const theme = useTheme();
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const view = useThread(botId, params.threadId ? String(params.threadId) : undefined);

  const row = useMemo(() => (paired ? botRows(paired.inbox).find((candidate) => candidate.bot.id === botId) : undefined), [paired, botId]);
  const bot = row?.bot ?? paired?.inbox.bots.find((candidate) => candidate.id === botId);
  const name = bot?.name ?? 'Bot';
  const avatar = row?.avatar ?? parseAvatar(bot?.avatar, botId);

  const rows = useMemo((): Row[] => {
    const items: Row[] = view.state ? timeline(view.state) : [];
    if (view.outgoing) items.push({ kind: 'outgoing', key: 'outgoing', outgoing: view.outgoing });
    if (view.state && showTyping(view.state)) items.push({ kind: 'typing', key: 'typing' });
    return items.reverse();
  }, [view.state, view.outgoing]);

  if (!paired) return null;
  const { capabilities } = paired;
  const run = view.state ? activeRun(view.state) : undefined;
  const status = row?.status ?? 'idle';

  const renderRow = ({ item }: { item: Row }): ReactElement => {
    const body = (() => {
      switch (item.kind) {
        case 'message':
          if (item.message.role === 'user') return <UserBubble text={item.message.content} time={shortTime(item.message.createdAt)} />;
          if (item.message.role === 'system') {
            return (
              <Text variant="meta" tone="ink2" style={styles.center}>
                {item.message.content}
              </Text>
            );
          }
          return <BotText text={item.message.content} time={shortTime(item.message.createdAt)} />;
        case 'draft':
          return <BotText text={item.draft.content} />;
        case 'tool':
          return <ToolCallCard call={item.call} />;
        case 'approval':
          return (
            <ApprovalCard
              approval={item.approval}
              botName={name}
              avatar={avatar}
              canApprove={capabilities.approve}
              onPress={() => router.push({ pathname: '/approval/[id]', params: { id: item.approval.id } })}
            />
          );
        case 'error':
          return (
            <View style={[styles.errorRow, { gap: theme.space[2] }]} accessible accessibilityLabel={`Run stopped: ${item.run.error ?? ''}`}>
              <Icon name="alert" size={16} tone="ink2" />
              <Text variant="small" tone="ink2" style={styles.flex}>
                Stopped — {item.run.error}
              </Text>
            </View>
          );
        case 'typing':
          return <TypingIndicator label={`${name} is working`} />;
        case 'outgoing':
          return (
<UserBubble text={item.outgoing.content} faded note="Sending…" />
          );
      }
    })();
    return (
      <Animated.View entering={riseIn(reduced)} style={{ marginBottom: theme.space[4] }}>
        {body}
      </Animated.View>
    );
  };

  const empty =
    view.loading ? (
      <ActivityIndicator color={theme.color.ink3} />
    ) : view.error ? (
      <View style={{ gap: theme.space[4], alignItems: 'center' }}>
        <Text variant="body" tone="ink2" style={styles.center}>
          {view.error}
        </Text>
        <Button label="Try again" variant="secondary" onPress={view.reload} />
      </View>
    ) : (
      <View style={{ gap: theme.space[4], alignItems: 'center' }}>
        <BotAvatar shape={avatar.shape} color={avatar.color} mood="idle" size="xl" />
        <Text variant="body" tone="ink2" style={styles.center}>
          {capabilities.chat ? `Say hi to ${name}.` : `No conversations with ${name} yet.`}
        </Text>
      </View>
    );

  const footer = capabilities.chat ? (
    <View style={{ gap: theme.space[2] }}>
      {view.sendError ? (
        <Text variant="meta" tone="ink2" accessibilityLiveRegion="polite" style={{ paddingHorizontal: theme.space[2] }}>
          Not sent. {view.sendError}
        </Text>
      ) : null}
      <Composer
        placeholder={`Message ${name}`}
        onSend={view.send}
        onStop={run && capabilities.cancel ? () => void view.cancel(run.id).catch(() => undefined) : undefined}
      />
    </View>
  ) : (
    <View style={[styles.readOnly, { gap: theme.space[2], paddingVertical: theme.space[3] }]}>
      <Icon name="lock" size={16} tone="ink3" />
      <Text variant="meta" tone="ink2">
        {paired.session.role === 'approver' ? 'This phone answers approvals only.' : 'This phone can read threads only.'}
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
            <BotAvatar shape={avatar.shape} color={avatar.color} mood={STATUS_MOOD[status]} size="md" />
            <View style={styles.headerText}>
              <Text variant="label" numberOfLines={1}>
                {name}
              </Text>
              <StatusDot status={status} />
            </View>
          </View>
        }
      />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {rows.length === 0 ? (
          <View style={[styles.flex, styles.emptyWrap, { padding: theme.space[6] }]}>{empty}</View>
        ) : (
          <FlatList
            inverted
            data={rows}
            keyExtractor={(item) => item.key}
            renderItem={renderRow}
            contentContainerStyle={{ paddingHorizontal: theme.space[4], paddingTop: theme.space[4] }}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            accessibilityLabel={`Conversation with ${name}`}
          />
        )}
        <View style={{ paddingHorizontal: theme.space[3], paddingTop: theme.space[2], paddingBottom: Math.max(insets.bottom, theme.space[3]) }}>
          {footer}
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  center: { textAlign: 'center' },
  emptyWrap: { alignItems: 'center', justifyContent: 'center' },
  userWrap: { alignSelf: 'flex-end', alignItems: 'flex-end', maxWidth: '85%' },
  errorRow: { flexDirection: 'row', alignItems: 'flex-start' },
  readOnly: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flexDirection: 'row', alignItems: 'center' },
  headerText: { gap: 0, minWidth: 0, maxWidth: 220 },
});

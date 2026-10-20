import type { Bot, Message } from '@brot/protocol';
import { parseAvatar } from '@brot/ui/avatar';
import { router } from 'expo-router';
import { useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';
import { BotFace } from '../avatar/BotFace';
import type { ThreadView } from '../core/useThread';
import { shortTime } from '../format';
import { t } from '../i18n';
import { useLocale } from '../i18n/useLocale';
import { splitMentions } from '../state/mentions';
import { draftAuthor, showTyping, timeline, typingBots, type Ask, type Handoff, type TimelineItem } from '../state/thread';
import { taskStatusLabel } from '../state/tasks';
import { riseIn } from '../theme/motion';
import { useTheme } from '../theme/ThemeProvider';
import { ApprovalCard } from './ApprovalCard';
import { Icon } from './Icon';
import { Text } from './Text';
import { ToolCallCard } from './ToolCallCard';
import { TypingIndicator } from './TypingIndicator';

type Row =
  | (TimelineItem & { author?: string; showAuthor?: boolean })
  | { kind: 'typing'; key: string; botId?: string }
  | { kind: 'outgoing'; key: string; content: string };

export interface ConversationProps {
  view: ThreadView;
  bots: Bot[];
  /** The DM's bot, or the room's lead: the author of assistant messages without `authorBotId`. */
  defaultBotId: string;
  room: boolean;
  canApprove: boolean;
  accessibilityLabel: string;
  empty: ReactNode;
}

/** Plain text with @mentions of known bots set in medium weight, so they read as names. */
function RichText({ text, bots }: { text: string; bots: Bot[] }): ReactElement {
  const parts = useMemo(() => splitMentions(text, bots), [text, bots]);
  return (
    <Text variant="body" selectable>
      {parts.map((part, index) =>
        part.kind === 'mention' ? (
          <Text key={index} variant="bodyStrong">
            {part.text}
          </Text>
        ) : (
          part.text
        ),
      )}
    </Text>
  );
}

function UserBubble({ text, bots, time, note }: { text: string; bots: Bot[]; time?: string; note?: string }): ReactElement {
  const theme = useTheme();
  return (
    <View style={[styles.userWrap, { gap: theme.space[1] }]}>
      <View
        style={{
          backgroundColor: theme.color.surface2,
          borderRadius: theme.radius.xl,
          paddingHorizontal: theme.space[4],
          paddingVertical: theme.space[2] + 2,
          opacity: note ? 0.6 : 1,
        }}
      >
        <RichText text={text} bots={bots} />
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

function AuthorLine({ bot, botId, via, streaming }: { bot?: Bot; botId: string; via?: Bot; streaming?: boolean }): ReactElement {
  const theme = useTheme();
  const name = bot?.name ?? t('common.aBot');
  return (
    <View style={[styles.row, { gap: theme.space[2] }]}>
      <BotFace bot={bot} botId={botId} size={24} mood={streaming ? 'thinking' : 'idle'} />
      <Text variant="label" numberOfLines={1} style={styles.shrink}>
        {via ? t('thread.to', { from: name, to: via.name }) : name}
      </Text>
    </View>
  );
}

function BotText({ text, bots, time }: { text: string; bots: Bot[]; time?: string }): ReactElement {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space[1] }}>
      <RichText text={text} bots={bots} />
      {time ? (
        <Text variant="caption" tone="ink3" numeric>
          {time}
        </Text>
      ) : null}
    </View>
  );
}

function AskRow({ ask, find }: { ask: Ask; find: (id: string) => Bot | undefined }): ReactElement {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  const from = find(ask.fromBotId);
  const to = find(ask.toBotId);
  const title = t('room.asked', { from: from?.name ?? t('common.aBot'), to: to?.name ?? t('common.aBot') });
  return (
    <View style={[styles.card, { borderColor: theme.color.line, borderRadius: theme.radius.md, backgroundColor: theme.color.surface }]}>
      <Pressable
        onPress={() => setOpen((value) => !value)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${title}. ${ask.answer === undefined ? t('room.waitingAnswer') : ''}`}
        style={({ pressed }) => [styles.row, styles.summary, { gap: theme.space[2], paddingHorizontal: theme.space[3] }, pressed ? { backgroundColor: theme.color.surface2 } : null]}
      >
        <View style={styles.row}>
          <BotFace bot={from} botId={ask.fromBotId} size={20} mood="idle" />
          <View style={{ marginLeft: -6 }}>
            <BotFace bot={to} botId={ask.toBotId} size={20} mood={ask.answer === undefined ? 'thinking' : 'idle'} />
          </View>
        </View>
        <Text variant="small" tone="ink2" numberOfLines={1} style={styles.shrink}>
          {title}
        </Text>
        {ask.answer === undefined ? <TypingIndicator label={t('room.waitingAnswer')} /> : null}
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} tone="ink3" />
      </Pressable>
      {open ? (
        <Animated.View entering={riseIn(reduced, 4)} style={{ paddingHorizontal: theme.space[3], paddingBottom: theme.space[3], gap: theme.space[2] }}>
          {ask.question ? (
            <View style={{ gap: 2 }}>
              <Text variant="caption" tone="ink2">
                {t('room.question')}
              </Text>
              <Text variant="small" selectable>
                {ask.question}
              </Text>
            </View>
          ) : null}
          {ask.answer !== undefined ? (
            <View style={{ gap: 2 }}>
              <Text variant="caption" tone="ink2">
                {t('room.answer')}
              </Text>
              <Text variant="small" selectable>
                {ask.answer}
              </Text>
            </View>
          ) : null}
        </Animated.View>
      ) : null}
    </View>
  );
}

function HandoffRow({ handoff, find }: { handoff: Handoff; find: (id: string) => Bot | undefined }): ReactElement {
  const theme = useTheme();
  const line = t('room.handoff', { from: find(handoff.fromBotId)?.name ?? t('common.aBot'), to: find(handoff.toBotId)?.name ?? t('common.aBot') });
  return (
    <View style={[styles.row, styles.centerRow, { gap: theme.space[2] }]} accessible accessibilityLabel={handoff.note ? `${line}. ${handoff.note}` : line}>
      <Icon name="baton" size={14} tone="ink2" />
      <Text variant="meta" tone="ink2" style={styles.shrink}>
        {line}
        {handoff.note ? ` · ${handoff.note}` : ''}
      </Text>
    </View>
  );
}

/** The timeline of a DM or a room, newest at the bottom, with team rows and per-author heads in rooms. */
export function Conversation({ view, bots, defaultBotId, room, canApprove, accessibilityLabel, empty }: ConversationProps): ReactElement {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const locale = useLocale();
  const extra = useMemo(() => ({ locale, bots, canApprove }), [locale, bots, canApprove]);
  const find = useMemo(() => {
    const byId = new Map(bots.map((bot) => [bot.id, bot]));
    return (id: string) => byId.get(id);
  }, [bots]);

  const rows = useMemo((): Row[] => {
    if (!view.state) return view.outgoing ? [{ kind: 'outgoing', key: 'outgoing', content: view.outgoing.content }] : [];
    const state = view.state;
    const items: Row[] = [];
    let lastAuthor: string | undefined;
    for (const item of timeline(state)) {
      if (item.kind === 'message' && item.message.role === 'assistant') {
        const author = item.message.authorBotId ?? defaultBotId;
        items.push({ ...item, author, showAuthor: room && (lastAuthor !== author || item.message.viaBotId !== undefined) });
        lastAuthor = author;
      } else if (item.kind === 'draft') {
        const author = draftAuthor(state, item.draft) ?? defaultBotId;
        items.push({ ...item, author, showAuthor: room && lastAuthor !== author });
        lastAuthor = author;
      } else {
        items.push(item);
        if (item.kind !== 'tool') lastAuthor = undefined;
      }
    }
    if (view.outgoing) items.push({ kind: 'outgoing', key: 'outgoing', content: view.outgoing.content });
    if (room) for (const botId of typingBots(state)) items.push({ kind: 'typing', key: `typing:${botId}`, botId });
    else if (showTyping(state)) items.push({ kind: 'typing', key: 'typing' });
    return items.reverse();
  }, [view.state, view.outgoing, defaultBotId, room]);

  // Only rows that arrive after the first render rise in; the loaded history just appears.
  const seen = useRef<Set<string> | null>(null);
  if (seen.current === null && !view.loading) seen.current = new Set(rows.map((row) => row.key));
  const isNew = (key: string) => seen.current !== null && !seen.current.has(key);

  const renderMessage = (message: Message, row: Row & { author?: string; showAuthor?: boolean }): ReactElement => {
    if (message.role === 'user') return <UserBubble text={message.content} bots={bots} time={shortTime(message.createdAt)} />;
    if (message.role === 'system') {
      return (
        <Text variant="meta" tone="ink2" style={styles.centerText}>
          {message.content}
        </Text>
      );
    }
    const author = row.author ?? defaultBotId;
    return (
      <View style={{ gap: theme.space[2] }}>
        {row.showAuthor ? <AuthorLine bot={find(author)} botId={author} via={message.viaBotId ? find(message.viaBotId) : undefined} /> : null}
        <BotText text={message.content} bots={bots} time={shortTime(message.createdAt)} />
      </View>
    );
  };

  const renderRow = ({ item }: { item: Row }): ReactElement => {
    const body = (() => {
      switch (item.kind) {
        case 'message':
          return renderMessage(item.message, item);
        case 'draft': {
          const author = item.author ?? defaultBotId;
          return (
            <View style={{ gap: theme.space[2] }}>
              {item.showAuthor ? <AuthorLine bot={find(author)} botId={author} streaming /> : null}
              <BotText text={item.draft.content} bots={bots} />
            </View>
          );
        }
        case 'tool':
          return <ToolCallCard call={item.call} />;
        case 'approval': {
          const bot = find(item.approval.botId);
          return (
            <ApprovalCard
              approval={item.approval}
              botName={bot?.name ?? t('common.aBot')}
              avatar={parseAvatar(bot?.avatar, item.approval.botId)}
              canApprove={canApprove}
              onPress={() => router.push({ pathname: '/approval/[id]', params: { id: item.approval.id } })}
            />
          );
        }
        case 'error':
          return (
            <View style={[styles.row, styles.top, { gap: theme.space[2] }]} accessible accessibilityLabel={t('thread.runStopped', { error: item.run.error ?? '' })}>
              <Icon name="alert" size={16} tone="ink2" />
              <Text variant="small" tone="ink2" style={styles.shrink}>
                {t('thread.stopped', { error: item.run.error ?? '' })}
              </Text>
            </View>
          );
        case 'ask':
          return <AskRow ask={item.ask} find={find} />;
        case 'handoff':
          return <HandoffRow handoff={item.handoff} find={find} />;
        case 'task': {
          const to = find(item.task.assigneeBotId);
          const from = item.task.createdByBotId ? find(item.task.createdByBotId) : undefined;
          const line = from
            ? t('room.taskDelegated', { from: from.name, to: to?.name ?? t('common.aBot') })
            : t('room.taskCreated', { to: to?.name ?? t('common.aBot') });
          return (
            <Pressable
              onPress={() => router.push('/tasks')}
              accessibilityRole="button"
              accessibilityLabel={`${line}: ${item.task.title}. ${taskStatusLabel(item.task.status)}`}
              style={({ pressed }) => [
                styles.card,
                styles.row,
                { gap: theme.space[3], padding: theme.space[3], borderColor: theme.color.line, borderRadius: theme.radius.md, backgroundColor: pressed ? theme.color.surface2 : theme.color.surface },
              ]}
            >
              <BotFace bot={to} botId={item.task.assigneeBotId} size={28} mood={item.task.status === 'in_progress' ? 'thinking' : item.task.status === 'done' ? 'success' : 'idle'} />
              <View style={[styles.shrink, { gap: 2 }]}>
                <Text variant="caption" tone="ink2" numberOfLines={1}>
                  {line}
                </Text>
                <Text variant="label" numberOfLines={2}>
                  {item.task.title}
                </Text>
              </View>
              <Text variant="caption" tone="ink2">
                {taskStatusLabel(item.task.status)}
              </Text>
            </Pressable>
          );
        }
        case 'typing': {
          const bot = item.botId ? find(item.botId) : find(defaultBotId);
          const label = t('thread.working', { name: bot?.name ?? t('common.aBot') });
          return item.botId ? (
            <View style={[styles.row, { gap: theme.space[2] }]}>
              <BotFace bot={bot} botId={item.botId} size={24} mood="thinking" />
              <TypingIndicator label={label} />
            </View>
          ) : (
            <TypingIndicator label={label} />
          );
        }
        case 'outgoing':
          return <UserBubble text={item.content} bots={bots} note={t('thread.sending')} />;
      }
    })();
    return (
      <Animated.View entering={isNew(item.key) || item.kind === 'typing' ? riseIn(reduced) : undefined} style={{ marginBottom: theme.space[4] }}>
        {body}
      </Animated.View>
    );
  };

  if (rows.length === 0) return <View style={[styles.fill, styles.emptyWrap, { padding: theme.space[6] }]}>{empty}</View>;

  return (
    <FlatList
      inverted
      data={rows}
      keyExtractor={(item) => item.key}
      renderItem={renderRow}
      extraData={extra}
      contentContainerStyle={{ paddingHorizontal: theme.space[4], paddingTop: theme.space[4] }}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      accessibilityLabel={accessibilityLabel}
    />
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, minWidth: 0 },
  shrink: { flexShrink: 1, minWidth: 0 },
  row: { flexDirection: 'row', alignItems: 'center' },
  top: { alignItems: 'flex-start' },
  centerRow: { justifyContent: 'center' },
  centerText: { textAlign: 'center' },
  emptyWrap: { alignItems: 'center', justifyContent: 'center' },
  userWrap: { alignSelf: 'flex-end', alignItems: 'flex-end', maxWidth: '85%' },
  card: { borderWidth: 1, overflow: 'hidden' },
  summary: { minHeight: 40 },
});

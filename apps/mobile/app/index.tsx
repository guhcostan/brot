import type { Approval, Takeover } from '@brot/protocol';
import { parseAvatar } from '@brot/ui/avatar';
import { router } from 'expo-router';
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { ActivityIndicator, RefreshControl, SectionList, StyleSheet, View } from 'react-native';
import Animated, { LinearTransition, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePaired } from '../src/core/BrotProvider';
import { BotAvatar, BrandMark } from '../src/avatar/BotAvatar';
import { connectionLabel, shortTime } from '../src/format';
import { plural, t } from '../src/i18n';
import { STATUS_MOOD, botName, botRows, inboxApprovals, roomRows, takeoverRequests, type BotRow, type RoomRow } from '../src/state/inbox';
import { riseIn } from '../src/theme/motion';
import { letterSpacing } from '../src/theme/theme';
import { useTheme } from '../src/theme/ThemeProvider';
import { ApprovalCard } from '../src/ui/ApprovalCard';
import { AvatarStack } from '../src/ui/AvatarStack';
import { Button } from '../src/ui/Button';
import { Icon } from '../src/ui/Icon';
import { PressScale } from '../src/ui/Pressable';
import { IconButton, Screen, SectionLabel } from '../src/ui/Screen';
import { StatusDot } from '../src/ui/StatusDot';
import { TakeoverCard } from '../src/ui/TakeoverCard';
import { Text } from '../src/ui/Text';
import { useLocale } from '../src/i18n/useLocale';

type Item =
  | { kind: 'takeover'; takeover: Takeover }
  | { kind: 'approval'; approval: Approval }
  | { kind: 'room'; row: RoomRow }
  | { kind: 'bot'; row: BotRow };

function TakeoverRow({ takeover }: { takeover: Takeover }): ReactElement {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const bot = usePaired()?.inbox.bots.find((candidate) => candidate.id === takeover.botId);
  return (
    <Animated.View
      entering={riseIn(reduced, 8, 220)}
      layout={reduced ? undefined : LinearTransition.duration(theme.motion.base)}
      style={{ marginHorizontal: theme.space[4], marginBottom: theme.space[2] }}
    >
      <TakeoverCard takeover={takeover} bot={bot} onPress={() => router.push({ pathname: '/computer/[botId]', params: { botId: takeover.botId } })} />
    </Animated.View>
  );
}

function RoomListRow({ row }: { row: RoomRow }): ReactElement {
  const theme = useTheme();
  const time = shortTime(row.lastActivityAt);
  const members = plural('inbox.roomMembersOne', 'inbox.roomMembersMany', row.members.length);
  const preview = row.preview ? `${row.authorName ? `${row.authorName}: ` : ''}${row.preview}` : `${members} · ${row.members.map((bot) => bot.name).join(', ')}`;
  return (
    <PressScale
      pressedScale={0.985}
      onPress={() => router.push({ pathname: '/room/[threadId]', params: { threadId: row.room.id } })}
      accessibilityRole="button"
      accessibilityLabel={`${row.room.title}, ${members}. ${preview}`}
      style={[styles.bot, { paddingHorizontal: theme.space[4], paddingVertical: theme.space[3], gap: theme.space[3] }]}
    >
      <View style={styles.stack}>
        <AvatarStack bots={row.members} size={28} max={2} moodFor={(bot) => (row.working.includes(bot.id) ? 'thinking' : 'idle')} />
      </View>
      <View style={[styles.flex, { gap: 2 }]}>
        <View style={styles.titleRow}>
          <Text variant="bodyStrong" numberOfLines={1} style={styles.flex}>
            {row.room.title}
          </Text>
          {time ? (
            <Text variant="meta" tone="ink3" numeric>
              {time}
            </Text>
          ) : null}
        </View>
        <Text variant="meta" tone="ink2" numberOfLines={1}>
          {preview}
        </Text>
      </View>
    </PressScale>
  );
}

function ApprovalRow({ approval, from, canApprove }: { approval: Approval; from: string; canApprove: boolean }): ReactElement {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const inbox = usePaired()?.inbox;
  const bot = inbox?.bots.find((candidate) => candidate.id === approval.botId);

  return (
    <Animated.View
      entering={riseIn(reduced, 8, 220)}
      layout={reduced ? undefined : LinearTransition.duration(theme.motion.base)}
      style={{ marginHorizontal: theme.space[4], marginBottom: theme.space[2] }}
    >
      <ApprovalCard
        approval={approval}
        botName={from}
        avatar={parseAvatar(bot?.avatar, approval.botId)}
        canApprove={canApprove}
        onPress={() => router.push({ pathname: '/approval/[id]', params: { id: approval.id } })}
      />
    </Animated.View>
  );
}

function BotListRow({ row }: { row: BotRow }): ReactElement {
  const theme = useTheme();
  const time = row.lastActivityAt ? shortTime(row.lastActivityAt) : '';
  return (
    <PressScale
      pressedScale={0.985}
      onPress={() => router.push({ pathname: '/thread/[botId]', params: { botId: row.bot.id } })}
      accessibilityRole="button"
      accessibilityLabel={`${row.bot.name}, ${row.statusLabel}${row.preview ? `. ${row.preview}` : ''}`}
      style={[styles.bot, { paddingHorizontal: theme.space[4], paddingVertical: theme.space[3], gap: theme.space[3] }]}
    >
      <BotAvatar shape={row.avatar.shape} color={row.avatar.color} mood={STATUS_MOOD[row.status]} size="lg" />
      <View style={[styles.flex, { gap: 2 }]}>
        <View style={styles.titleRow}>
          <Text variant="bodyStrong" numberOfLines={1} style={styles.flex}>
            {row.bot.name}
          </Text>
          {time ? (
            <Text variant="meta" tone="ink3" numeric>
              {time}
            </Text>
          ) : null}
        </View>
        <View style={styles.titleRow}>
          <StatusDot status={row.status} label={row.pending > 1 ? t('inbox.waitingMany', { count: row.pending }) : undefined} />
          <Text variant="meta" tone="ink2" numberOfLines={1} style={styles.flex}>
            {row.preview ?? row.bot.job}
          </Text>
        </View>
      </View>
    </PressScale>
  );
}

function ConnectionLine(): ReactElement | null {
  const paired = usePaired();
  const theme = useTheme();
  if (!paired || paired.liveStatus === 'live' || paired.revoked) return null;
  const offline = paired.liveStatus === 'reconnecting';
  return (
    <View
      style={[styles.connection, { paddingHorizontal: theme.space[4], paddingVertical: theme.space[2], gap: theme.space[2], backgroundColor: theme.color.surface2 }]}
      accessibilityLiveRegion="polite"
    >
      {offline ? <Icon name="wifiOff" size={16} tone="ink2" /> : <ActivityIndicator size="small" color={theme.color.ink3} />}
      <Text variant="meta" tone="ink2" numberOfLines={1}>
        {connectionLabel(paired.liveStatus, paired.lastEventAt)}
      </Text>
    </View>
  );
}

function RevokedBanner(): ReactElement {
  const paired = usePaired();
  const theme = useTheme();
  const [busy, setBusy] = useState(false);
  return (
    <View style={[styles.revoked, { margin: theme.space[4], padding: theme.space[4], gap: theme.space[3], borderRadius: theme.radius.lg, borderColor: theme.color.line, backgroundColor: theme.color.surface2 }]}>
      <View style={[styles.titleRow, { gap: theme.space[2] }]}>
        <Icon name="lock" size={18} tone="ink" />
        <Text variant="subheading">{t('inbox.revokedTitle')}</Text>
      </View>
      <Text variant="small" tone="ink2">
        {t('inbox.revokedBody')}
      </Text>
      <Button
        label={t('inbox.pairAgain')}
        busy={busy}
        onPress={() => {
          setBusy(true);
          void paired?.forget().finally(() => setBusy(false));
        }}
      />
    </View>
  );
}

export default function Inbox(): ReactElement | null {
  const locale = useLocale();
  const paired = usePaired();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);

  const inbox = paired?.inbox;
  const sections = useMemo(() => {
    if (!inbox) return [];
    const waiting = [
      ...takeoverRequests(inbox).map((takeover): Item => ({ kind: 'takeover', takeover })),
      ...inboxApprovals(inbox).map((approval): Item => ({ kind: 'approval', approval })),
    ];
    const rooms = roomRows(inbox).map((row): Item => ({ kind: 'room', row }));
    const bots = botRows(inbox).map((row): Item => ({ kind: 'bot', row }));
    return [
      ...(waiting.length > 0 ? [{ key: 'waiting', title: waiting.length === 1 ? t('inbox.waiting') : t('inbox.waitingCount', { count: waiting.length }), data: waiting }] : []),
      ...(rooms.length > 0 ? [{ key: 'rooms', title: t('inbox.rooms'), data: rooms }] : []),
      ...(bots.length > 0 ? [{ key: 'bots', title: t('inbox.bots'), data: bots }] : []),
    ];
  }, [inbox]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await paired?.refresh();
    setRefreshing(false);
  }, [paired]);

  if (!paired || !inbox) return null;

  const empty = paired.inboxLoading ? (
    <View style={styles.centered}>
      <ActivityIndicator color={theme.color.ink3} />
    </View>
  ) : paired.inboxError ? (
    <View style={[styles.centered, { gap: theme.space[4], padding: theme.space[6] }]}>
      <Text variant="body" tone="ink2" style={styles.textCenter}>
        {paired.inboxError}
      </Text>
      <Button label={t('common.tryAgain')} variant="secondary" onPress={() => void onRefresh()} />
    </View>
  ) : (
    <View style={[styles.centered, { gap: theme.space[4], padding: theme.space[6] }]}>
      <BotAvatar shape="cloud" color="gray" mood="sleeping" size="xl" />
      <Text variant="body" tone="ink2" style={styles.textCenter}>
        {t('inbox.empty')}
      </Text>
    </View>
  );

  return (
    <Screen>
      <View style={[styles.topBar, { paddingLeft: theme.space[4], paddingRight: theme.space[2] }]}>
        <View style={[styles.titleRow, { gap: theme.space[2] }]} accessible accessibilityRole="header" accessibilityLabel="Brot">
          <BrandMark size={26} />
          <Text variant="heading" style={{ letterSpacing: letterSpacing('tight', theme.fontSize.lg) }}>
            brot
          </Text>
        </View>
        <View style={styles.titleRow}>
          <IconButton icon="board" label={t('inbox.tasks')} onPress={() => router.push('/tasks')} />
          <IconButton icon="sliders" label={t('inbox.settings')} onPress={() => router.push('/settings')} />
        </View>
      </View>
      <ConnectionLine />
      {paired.revoked ? <RevokedBanner /> : null}
      <SectionList
        sections={sections}
        keyExtractor={(item) => {
          switch (item.kind) {
            case 'takeover':
              return `k:${item.takeover.botId}`;
            case 'approval':
              return `a:${item.approval.id}`;
            case 'room':
              return `r:${item.row.room.id}`;
            case 'bot':
              return `b:${item.row.bot.id}`;
          }
        }}
        renderSectionHeader={({ section }) => (
          <View style={{ backgroundColor: theme.color.bg }}>
            <SectionLabel tone={section.key === 'waiting' ? 'attentionText' : 'ink2'}>{section.title}</SectionLabel>
          </View>
        )}
        renderItem={({ item }) => {
          switch (item.kind) {
            case 'takeover':
              return <TakeoverRow takeover={item.takeover} />;
            case 'approval':
              return <ApprovalRow approval={item.approval} from={botName(inbox, item.approval.botId)} canApprove={paired.capabilities.approve} />;
            case 'room':
              return <RoomListRow row={item.row} />;
            case 'bot':
              return <BotListRow row={item.row} />;
          }
        }}
        ListEmptyComponent={empty}
        contentContainerStyle={[{ paddingBottom: insets.bottom + theme.space[6] }, sections.length === 0 ? styles.grow : null]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={theme.color.ink3} colors={[theme.color.ink]} />}
        stickySectionHeadersEnabled={false}
        extraData={locale}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  grow: { flexGrow: 1 },
  topBar: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bot: { flexDirection: 'row', alignItems: 'center' },
  connection: { flexDirection: 'row', alignItems: 'center' },
  revoked: { borderWidth: 1 },
  stack: { width: 44, alignItems: 'flex-start' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  textCenter: { textAlign: 'center' },
});

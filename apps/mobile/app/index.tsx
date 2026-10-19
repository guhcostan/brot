import type { Approval } from '@brot/protocol';
import { parseAvatar } from '@brot/ui/avatar';
import { router } from 'expo-router';
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { ActivityIndicator, RefreshControl, SectionList, StyleSheet, View } from 'react-native';
import Animated, { LinearTransition, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePaired } from '../src/core/BrotProvider';
import { BotAvatar, BrandMark } from '../src/avatar/BotAvatar';
import { connectionLabel, shortTime } from '../src/format';
import { STATUS_MOOD, botName, botRows, inboxApprovals, type BotRow } from '../src/state/inbox';
import { riseIn } from '../src/theme/motion';
import { letterSpacing } from '../src/theme/theme';
import { useTheme } from '../src/theme/ThemeProvider';
import { ApprovalCard } from '../src/ui/ApprovalCard';
import { Button } from '../src/ui/Button';
import { Icon } from '../src/ui/Icon';
import { PressScale } from '../src/ui/Pressable';
import { IconButton, Screen, SectionLabel } from '../src/ui/Screen';
import { StatusDot } from '../src/ui/StatusDot';
import { Text } from '../src/ui/Text';

type Item = { kind: 'approval'; approval: Approval } | { kind: 'bot'; row: BotRow };

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
          <StatusDot status={row.status} label={row.pending > 1 ? `${row.pending} waiting for you` : undefined} />
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
        <Text variant="subheading">This phone was unpaired</Text>
      </View>
      <Text variant="small" tone="ink2">
        Your computer no longer accepts this phone. Pair it again to keep going.
      </Text>
      <Button
        label="Pair again"
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
  const paired = usePaired();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);

  const inbox = paired?.inbox;
  const sections = useMemo(() => {
    if (!inbox) return [];
    const approvals = inboxApprovals(inbox).map((approval): Item => ({ kind: 'approval', approval }));
    const bots = botRows(inbox).map((row): Item => ({ kind: 'bot', row }));
    return [
      ...(approvals.length > 0 ? [{ key: 'approvals', title: approvals.length === 1 ? 'Waiting for you' : `Waiting for you · ${approvals.length}`, data: approvals }] : []),
      ...(bots.length > 0 ? [{ key: 'bots', title: 'Bots', data: bots }] : []),
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
      <Button label="Try again" variant="secondary" onPress={() => void onRefresh()} />
    </View>
  ) : (
    <View style={[styles.centered, { gap: theme.space[4], padding: theme.space[6] }]}>
      <BotAvatar shape="cloud" color="gray" mood="sleeping" size="xl" />
      <Text variant="body" tone="ink2" style={styles.textCenter}>
        No bots yet. Create one on your computer to get started.
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
        <IconButton icon="sliders" label="Settings" onPress={() => router.push('/settings')} />
      </View>
      <ConnectionLine />
      {paired.revoked ? <RevokedBanner /> : null}
      <SectionList
        sections={sections}
        keyExtractor={(item) => (item.kind === 'approval' ? `a:${item.approval.id}` : `b:${item.row.bot.id}`)}
        renderSectionHeader={({ section }) => (
          <View style={{ backgroundColor: theme.color.bg }}>
            <SectionLabel tone={section.key === 'approvals' ? 'attentionText' : 'ink2'}>{section.title}</SectionLabel>
          </View>
        )}
        renderItem={({ item }) =>
          item.kind === 'approval' ? (
            <ApprovalRow approval={item.approval} from={botName(inbox, item.approval.botId)} canApprove={paired.capabilities.approve} />
          ) : (
            <BotListRow row={item.row} />
          )
        }
        ListEmptyComponent={empty}
        contentContainerStyle={[{ paddingBottom: insets.bottom + theme.space[6] }, sections.length === 0 ? styles.grow : null]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={theme.color.ink3} colors={[theme.color.ink]} />}
        stickySectionHeadersEnabled={false}
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
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  textCenter: { textAlign: 'center' },
});

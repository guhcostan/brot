import type { Approval, ApprovalDecision } from '@brot/protocol';
import { parseAvatar } from '@brot/ui/avatar';
import * as Haptics from 'expo-haptics';
import * as LocalAuthentication from 'expo-local-authentication';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState, type ReactElement } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { describeError, usePaired } from '../../src/core/BrotProvider';
import { BotAvatar } from '../../src/avatar/BotAvatar';
import { prettyJson, shortTime } from '../../src/format';
import { APPROVAL_KIND_LABELS, DECISION_LABELS, allowsAlways, needsBiometric, visibleArgs } from '../../src/state/approvals';
import { botName } from '../../src/state/inbox';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Button } from '../../src/ui/Button';
import { Field } from '../../src/ui/Field';
import { Icon } from '../../src/ui/Icon';
import { IconButton } from '../../src/ui/Screen';
import { Text } from '../../src/ui/Text';

/** Asks for Face ID, Touch ID or the device passcode. A phone with no lock set up cannot be asked, so it passes. */
async function confirmWithBiometrics(summary: string): Promise<boolean> {
  const [hardware, enrolled] = await Promise.all([LocalAuthentication.hasHardwareAsync(), LocalAuthentication.isEnrolledAsync()]);
  if (!hardware || !enrolled) return true;
  const result = await LocalAuthentication.authenticateAsync({ promptMessage: summary, cancelLabel: 'Cancel' });
  return result.success;
}

function useApproval(id: string): { approval?: Approval; loading: boolean; error?: string } {
  const paired = usePaired();
  const fromInbox = paired?.inbox.approvals[id];
  const [fetched, setFetched] = useState<Approval>();
  const [loading, setLoading] = useState(!fromInbox);
  const [error, setError] = useState<string>();
  const client = paired?.client;

  useEffect(() => {
    if (fromInbox || !client) return;
    let cancelled = false;
    setLoading(true);
    client
      .listApprovals()
      .then((all) => {
        if (cancelled) return;
        const found = all.find((candidate) => candidate.id === id);
        setFetched(found);
        if (!found) setError('This approval is gone.');
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(describeError(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fromInbox, client, id]);

  return { approval: fromInbox ?? fetched, loading: loading && !fromInbox, error };
}

function Args({ args }: { args: Record<string, unknown> }): ReactElement | null {
  const theme = useTheme();
  const entries = visibleArgs(args);
  if (entries.length === 0) return null;
  return (
    <View style={{ backgroundColor: theme.color.surface2, borderRadius: theme.radius.md, padding: theme.space[3], gap: theme.space[2] }}>
      {entries.map(([key, value]) => (
        <View key={key} style={{ gap: 2 }}>
          <Text variant="caption" tone="ink2">
            {key}
          </Text>
          <Text variant="mono" selectable numberOfLines={12}>
            {typeof value === 'string' ? value : prettyJson(value)}
          </Text>
        </View>
      ))}
    </View>
  );
}

export default function ApprovalSheet(): ReactElement | null {
  const { id } = useLocalSearchParams<{ id: string }>();
  const paired = usePaired();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { approval, loading, error } = useApproval(String(id));
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState<ApprovalDecision>();
  const [failure, setFailure] = useState<string>();

  if (!paired) return null;
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  if (!approval) {
    return (
      <View style={[styles.sheet, { padding: theme.space[6], gap: theme.space[4], backgroundColor: theme.color.surface }]}>
        {loading ? <ActivityIndicator color={theme.color.ink3} /> : <Text tone="ink2">{error ?? 'This approval is gone.'}</Text>}
        {!loading ? <Button label="Close" variant="secondary" onPress={close} /> : null}
      </View>
    );
  }

  const name = botName(paired.inbox, approval.botId);
  const bot = paired.inbox.bots.find((candidate) => candidate.id === approval.botId);
  const avatar = parseAvatar(bot?.avatar, approval.botId);
  const pending = approval.status === 'pending';
  const canAnswer = pending && paired.capabilities.approve;
  const gated = needsBiometric(approval.kind, 'allow_once');

  const decide = async (decision: ApprovalDecision) => {
    setFailure(undefined);
    setBusy(decision);
    try {
      if (needsBiometric(approval.kind, decision) && !(await confirmWithBiometrics(approval.summary))) {
        setFailure('Not allowed. The check was cancelled.');
        return;
      }
      const trimmed = reply.trim();
      await paired.resolveApproval(approval, decision, trimmed ? trimmed : undefined);
      void Haptics.notificationAsync(decision === 'deny' ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Success);
      close();
    } catch (cause) {
      setFailure(describeError(cause));
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <ScrollView
      style={{ backgroundColor: theme.color.surface }}
      contentContainerStyle={{ padding: theme.space[6], paddingBottom: Math.max(insets.bottom, theme.space[6]), gap: theme.space[4] }}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
    >
      <View style={[styles.row, { gap: theme.space[3] }]}>
        <BotAvatar shape={avatar.shape} color={avatar.color} mood={pending ? 'approval' : 'idle'} size="lg" />
        <View style={styles.flex}>
          <Text variant="label" numberOfLines={1}>
            {name}
          </Text>
          <Text variant="meta" tone="ink3" numeric>
            {shortTime(approval.createdAt)}
          </Text>
        </View>
        <IconButton icon="close" label="Close" onPress={close} tone="ink2" />
      </View>

      <View
        accessible
        accessibilityLabel={`${pending ? 'Approval needed' : DECISION_LABELS[approval.decision ?? 'deny']}: ${approval.summary}`}
        style={{
          borderWidth: 1,
          borderColor: pending ? theme.color.attention : theme.color.line,
          backgroundColor: pending ? theme.color.attentionSoft : theme.color.surface,
          borderRadius: theme.radius.lg,
          padding: theme.space[4],
          gap: theme.space[2],
        }}
      >
        <View style={[styles.row, { gap: theme.space[2] }]}>
          {pending ? <View style={[styles.dot, { backgroundColor: theme.color.attention }]} /> : null}
          <Text variant="caption" tone={pending ? 'attentionText' : 'ink2'}>
            {pending ? APPROVAL_KIND_LABELS[approval.kind] : `${APPROVAL_KIND_LABELS[approval.kind]} · ${approval.decision ? DECISION_LABELS[approval.decision] : approval.status}`}
          </Text>
        </View>
        <Text variant="title" accessibilityRole="header">
          {approval.summary}
        </Text>
        <Text variant="mono" tone="ink2">
          {approval.tool}
        </Text>
      </View>

      <Args args={approval.args} />

      {canAnswer ? (
        <>
          <Field
            label="Reply to the bot"
            hint="Optional. The bot reads it with your decision."
            value={reply}
            onChangeText={setReply}
            multiline
            editable={busy === undefined}
            placeholder="e.g. Use the work address instead"
          />
          {gated ? (
            <View style={[styles.row, { gap: theme.space[2] }]}>
              <Icon name="lock" size={16} tone="ink2" />
              <Text variant="meta" tone="ink2" style={styles.flex}>
                Allowing asks for Face ID or your passcode first.
              </Text>
            </View>
          ) : null}
          {failure ? (
            <Text variant="small" tone="attentionText" accessibilityLiveRegion="assertive">
              {failure}
            </Text>
          ) : null}
          <View style={{ gap: theme.space[2] }} accessibilityRole="none" accessibilityLabel="Decide">
            <Button label="Allow once" onPress={() => void decide('allow_once')} busy={busy === 'allow_once'} disabled={busy !== undefined} />
            <View style={[styles.row, { gap: theme.space[2] }]}>
              {allowsAlways(approval.kind) ? (
                <Button
                  label="Allow always"
                  variant="secondary"
                  accessibilityHint={`Lets ${name} use ${approval.tool} without asking again`}
                  onPress={() => void decide('allow_always')}
                  busy={busy === 'allow_always'}
                  disabled={busy !== undefined}
                  style={styles.flex}
                />
              ) : null}
              <Button label="Deny" variant="danger" onPress={() => void decide('deny')} busy={busy === 'deny'} disabled={busy !== undefined} style={styles.flex} />
            </View>
            {!allowsAlways(approval.kind) ? (
              <Text variant="meta" tone="ink3">
                {APPROVAL_KIND_LABELS[approval.kind]} actions are approved one at a time.
              </Text>
            ) : null}
          </View>
        </>
      ) : pending ? (
        <View style={[styles.row, { gap: theme.space[2], alignItems: 'flex-start' }]}>
          <Icon name="lock" size={16} tone="ink2" />
          <Text variant="small" tone="ink2" style={styles.flex}>
            This phone can view approvals but not answer them. Answer on your computer, or pair a phone as Approver or Full.
          </Text>
        </View>
      ) : (
        <>
          {approval.reply ? (
            <Text variant="small" tone="ink2">
              Reply: {approval.reply}
            </Text>
          ) : null}
          <Button label="Close" variant="secondary" onPress={close} />
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  sheet: { alignItems: 'stretch' },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1, minWidth: 0 },
  dot: { width: 6, height: 6, borderRadius: 3 },
});

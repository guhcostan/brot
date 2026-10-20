import type { Approval } from '@brot/protocol';
import type { AvatarSpec } from '@brot/ui/avatar';
import type { ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { BotAvatar } from '../avatar/BotAvatar';
import { t } from '../i18n';
import { approvalKindLabel, approvalSource, decisionLabel } from '../state/approvals';
import { useTheme } from '../theme/ThemeProvider';
import { Icon } from './Icon';
import { PressScale } from './Pressable';
import { Text } from './Text';

export interface ApprovalCardProps {
  approval: Approval;
  botName: string;
  avatar: AvatarSpec;
  canApprove: boolean;
  onPress: () => void;
}

/**
 * A tappable approval summary. Pending ones carry the attention border on --attention-soft, the only
 * chrome color; resolved ones fall back to a plain line with the decision in words.
 */
export function ApprovalCard({ approval, botName, avatar, canApprove, onPress }: ApprovalCardProps): ReactElement {
  const theme = useTheme();
  const c = theme.color;
  const pending = approval.status === 'pending';
  const outcome = approval.decision ? decisionLabel(approval.decision) : approval.status === 'denied' ? t('approval.denied') : t('approval.allowed');

  return (
    <PressScale
      pressedScale={0.98}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={pending ? t('approval.neededFrom', { name: botName, summary: approval.summary }) : `${outcome}: ${approval.summary}`}
      accessibilityHint={pending ? (canApprove ? t('approval.openHint') : t('approval.openHintViewOnly')) : undefined}
      style={[
        styles.card,
        {
          padding: theme.space[4],
          gap: theme.space[3],
          borderRadius: theme.radius.lg,
          borderColor: pending ? c.attention : c.line,
          backgroundColor: pending ? c.attentionSoft : c.surface,
        },
      ]}
    >
      <BotAvatar shape={avatar.shape} color={avatar.color} mood={pending ? 'approval' : 'idle'} size="md" animated={pending} />
      <View style={styles.body}>
        <Text variant="caption" tone={pending ? 'attentionText' : 'ink2'}>
          {pending ? approvalKindLabel(approval.kind) : `${approvalKindLabel(approval.kind)} · ${outcome}`}
        </Text>
        <Text variant="subheading" tone={pending ? 'ink' : 'ink2'} numberOfLines={2}>
          {approval.summary}
        </Text>
        <Text variant="monoSmall" tone="ink2" numberOfLines={1}>
          {approvalSource(approval, botName)}
        </Text>
      </View>
      {pending ? <Icon name="chevronRight" size={18} tone="ink3" /> : <Icon name={approval.status === 'denied' ? 'close' : 'check'} size={18} tone="ink2" />}
    </PressScale>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', borderWidth: 1 },
  body: { flex: 1, minWidth: 0, gap: 2 },
});

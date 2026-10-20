import type { Bot, Takeover } from '@brot/protocol';
import type { ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { BotFace } from '../avatar/BotFace';
import { t } from '../i18n';
import { useTheme } from '../theme/ThemeProvider';
import { Icon } from './Icon';
import { PressScale } from './Pressable';
import { Text } from './Text';

/** "Onça needs you: <reason>". A bot asked the person to take over its desktop; tapping opens the screen. */
export function TakeoverCard({ takeover, bot, onPress }: { takeover: Takeover; bot?: Bot; onPress: () => void }): ReactElement {
  const theme = useTheme();
  const c = theme.color;
  const name = bot?.name ?? t('common.aBot');
  const line = takeover.reason ? t('computer.needsYou', { name, reason: takeover.reason }) : t('computer.needsYouNoReason', { name });
  return (
    <PressScale
      pressedScale={0.98}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={line}
      accessibilityHint={t('computer.needsYouHint')}
      style={[
        styles.card,
        { padding: theme.space[4], gap: theme.space[3], borderRadius: theme.radius.lg, borderColor: c.attention, backgroundColor: c.attentionSoft },
      ]}
    >
      <BotFace bot={bot} botId={takeover.botId} mood="approval" size="lg" />
      <View style={styles.body}>
        <View style={[styles.row, { gap: theme.space[1] }]}>
          <Icon name="monitor" size={14} tone="attentionText" />
          <Text variant="caption" tone="attentionText">
            {t('computer.needsYouTitle', { name })}
          </Text>
        </View>
        <Text variant="subheading" numberOfLines={3}>
          {takeover.reason ?? t('computer.needsYouNoReason', { name })}
        </Text>
        <Text variant="meta" tone="ink2">
          {t('computer.open')}
        </Text>
      </View>
      <Icon name="chevronRight" size={18} tone="ink3" />
    </PressScale>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', borderWidth: 1 },
  body: { flex: 1, minWidth: 0, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center' },
});

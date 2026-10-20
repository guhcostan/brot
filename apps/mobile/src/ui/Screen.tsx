import type { ReactElement, ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { t } from '../i18n';
import { useTheme } from '../theme/ThemeProvider';
import { Icon, type IconName } from './Icon';
import { PressScale } from './Pressable';
import { Text } from './Text';

/** A full screen on --bg with the top safe area applied. The bottom inset is left to each screen's own footer. */
export function Screen({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }): ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return <View style={[styles.fill, { backgroundColor: theme.color.bg, paddingTop: insets.top }, style]}>{children}</View>;
}

export interface IconButtonProps {
  icon: IconName;
  label: string;
  onPress: () => void;
  tone?: 'ink' | 'ink2';
}

/** 44pt square tap target around a 20pt glyph. */
export function IconButton({ icon, label, onPress, tone = 'ink' }: IconButtonProps): ReactElement {
  const theme = useTheme();
  return (
    <PressScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      pressedScale={0.9}
      style={[styles.iconButton, { borderRadius: theme.radius.md }]}
    >
      <Icon name={icon} size={22} tone={tone} />
    </PressScale>
  );
}

export interface HeaderProps {
  title?: string;
  /** Rendered in place of the title, e.g. an avatar with a name and status. */
  center?: ReactNode;
  onBack?: () => void;
  right?: ReactNode;
  bordered?: boolean;
}

export function Header({ title, center, onBack, right, bordered = false }: HeaderProps): ReactElement {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.header,
        { paddingHorizontal: theme.space[2], borderBottomColor: bordered ? theme.color.line : 'transparent' },
      ]}
    >
      {onBack ? <IconButton icon="chevronLeft" label={t('common.back')} onPress={onBack} /> : <View style={styles.side} />}
      <View style={styles.center}>
        {center ?? (
          <Text variant="subheading" numberOfLines={1} accessibilityRole="header">
            {title}
          </Text>
        )}
      </View>
      <View style={[styles.side, styles.right]}>{right}</View>
    </View>
  );
}

/** Small uppercase-free section label: hierarchy from size and weight, not color (DESIGN.md section 5). */
export function SectionLabel({ children, tone = 'ink2' }: { children: string; tone?: 'ink2' | 'attentionText' }): ReactElement {
  const theme = useTheme();
  return (
    <Text variant="caption" tone={tone} accessibilityRole="header" style={{ paddingHorizontal: theme.space[4], paddingTop: theme.space[4], paddingBottom: theme.space[2] }}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { minHeight: 52, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  side: { minWidth: 44, flexDirection: 'row', alignItems: 'center' },
  right: { justifyContent: 'flex-end' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});

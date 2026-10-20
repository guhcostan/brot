import { router } from 'expo-router';
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { describeError, usePaired } from '../src/core/BrotProvider';
import { connectionLabel, shortTime } from '../src/format';
import { normalizeServerUrl } from '../src/pairing/payload';
import { registerForPush, type PushRegistration } from '../src/push/push';
import { LOCALES, LOCALE_NAMES, t } from '../src/i18n';
import { loadLocalePreference, saveLocalePreference, type LocalePreference } from '../src/i18n/preference';
import { secureStorage } from '../src/session/secureStorage';
import { roleLabel } from '../src/state/roles';
import { useTheme } from '../src/theme/ThemeProvider';
import { Button } from '../src/ui/Button';
import { Field } from '../src/ui/Field';
import { Header, Screen, SectionLabel } from '../src/ui/Screen';
import { Icon } from '../src/ui/Icon';
import { Text } from '../src/ui/Text';
import { useLocale } from '../src/i18n/useLocale';

function Group({ children }: { children: ReactNode }): ReactElement {
  const theme = useTheme();
  return (
    <View style={{ marginHorizontal: theme.space[4], borderWidth: 1, borderColor: theme.color.line, borderRadius: theme.radius.lg, backgroundColor: theme.color.surface, overflow: 'hidden' }}>
      {children}
    </View>
  );
}

function Row({ label, value, last = false, mono = false }: { label: string; value: string; last?: boolean; mono?: boolean }): ReactElement {
  const theme = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      style={[
        styles.row,
        { paddingHorizontal: theme.space[4], paddingVertical: theme.space[3], gap: theme.space[3], borderBottomColor: theme.color.line, borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth },
      ]}
    >
      <Text variant="small" tone="ink2">
        {label}
      </Text>
      <Text variant={mono ? 'mono' : 'small'} numberOfLines={1} style={styles.value}>
        {value}
      </Text>
    </View>
  );
}

function Choice({ label, selected, last, onPress }: { label: string; selected: boolean; last: boolean; onPress: () => void }): ReactElement {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.row,
        {
          paddingHorizontal: theme.space[4],
          paddingVertical: theme.space[3],
          borderBottomColor: theme.color.line,
          borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
          backgroundColor: pressed ? theme.color.surface2 : 'transparent',
        },
      ]}
    >
      <Text variant="small">{label}</Text>
      {selected ? <Icon name="check" size={18} tone="ink" /> : null}
    </Pressable>
  );
}

export default function SettingsScreen(): ReactElement | null {
  useLocale();
  const paired = usePaired();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [editing, setEditing] = useState(false);
  const [address, setAddress] = useState(paired?.session.serverUrl ?? '');
  const [addressError, setAddressError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [unpairing, setUnpairing] = useState(false);
  const [push, setPush] = useState<PushRegistration>();
  const [language, setLanguage] = useState<LocalePreference>('system');

  useEffect(() => {
    void registerForPush().then(setPush);
    void loadLocalePreference(secureStorage).then(setLanguage);
  }, []);

  if (!paired) return null;
  const { session } = paired;
  const role = roleLabel(session.role);

  const saveAddress = async () => {
    const url = normalizeServerUrl(address);
    if (!url.ok) {
      setAddressError(url.error);
      return;
    }
    setSaving(true);
    setAddressError(undefined);
    try {
      await paired.changeServerUrl(url.value);
      setEditing(false);
    } catch (cause) {
      setAddressError(describeError(cause));
    } finally {
      setSaving(false);
    }
  };

  const confirmUnpair = () => {
    const detail = paired.capabilities.revokeSelf
      ? t('settings.unpairRevoke')
      : t('settings.unpairForget');
    Alert.alert(t('settings.unpairTitle'), detail, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.unpairConfirm'),
        style: 'destructive',
        onPress: () => {
          setUnpairing(true);
          void paired
            .unpair()
            .then(({ revokedOnServer }) => {
              if (!revokedOnServer && paired.capabilities.revokeSelf) {
                Alert.alert(t('settings.unpairedLocal'), t('settings.unpairedLocalBody'));
              }
            })
            .finally(() => setUnpairing(false));
        },
      },
    ]);
  };

  return (
    <Screen>
      <Header title={t('settings.title')} onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, theme.space[6]) + theme.space[6] }} keyboardShouldPersistTaps="handled">
          <SectionLabel>{t('settings.computer')}</SectionLabel>
          {editing ? (
            <View style={{ marginHorizontal: theme.space[4], gap: theme.space[3] }}>
              <Field
                label={t('settings.address')}
                value={address}
                onChangeText={setAddress}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                mono
                error={addressError}
                hint={t('settings.addressHint')}
              />
              <View style={[styles.actions, { gap: theme.space[2] }]}>
                <Button
                  label={t('common.cancel')}
                  variant="secondary"
                  style={styles.flex}
                  disabled={saving}
                  onPress={() => {
                    setEditing(false);
                    setAddress(session.serverUrl);
                    setAddressError(undefined);
                  }}
                />
                <Button label={t('common.save')} style={styles.flex} busy={saving} onPress={() => void saveAddress()} />
              </View>
            </View>
          ) : (
            <>
              <Group>
                <Row label={t('settings.address')} value={session.serverUrl} mono />
                <Row label={t('settings.status')} value={connectionLabel(paired.liveStatus, paired.lastEventAt)} last />
              </Group>
              <View style={{ marginHorizontal: theme.space[4], marginTop: theme.space[2] }}>
                <Button label={t('settings.changeAddress')} variant="ghost" size="sm" onPress={() => setEditing(true)} style={styles.start} />
              </View>
            </>
          )}

          <SectionLabel>{t('settings.thisPhone')}</SectionLabel>
          <Group>
            <Row label={t('settings.name')} value={session.deviceName} />
            <Row label={t('settings.role')} value={role.title} />
            <Row label={t('settings.paired')} value={shortTime(session.pairedAt)} last />
          </Group>
          <Text variant="meta" tone="ink2" style={{ marginHorizontal: theme.space[4], marginTop: theme.space[2] }}>
            {role.detail}
          </Text>

          <SectionLabel>{t('settings.notifications')}</SectionLabel>
          <Group>
            <Row label={t('settings.push')} value={push?.status === 'registered' ? t('settings.pushOn') : t('settings.pushLater')} last />
          </Group>
          {push?.status === 'unavailable' ? (
            <Text variant="meta" tone="ink2" style={{ marginHorizontal: theme.space[4], marginTop: theme.space[2] }}>
              {push.reason}
            </Text>
          ) : null}

          <SectionLabel>{t('settings.language')}</SectionLabel>
          <Group>
            {(['system', ...LOCALES] as const).map((option, index, all) => (
              <Choice
                key={option}
                label={option === 'system' ? t('settings.languageSystem') : LOCALE_NAMES[option]}
                selected={language === option}
                last={index === all.length - 1}
                onPress={() => {
                  setLanguage(option);
                  void Haptics.selectionAsync();
                  void saveLocalePreference(secureStorage, option);
                }}
              />
            ))}
          </Group>

          <View style={{ marginHorizontal: theme.space[4], marginTop: theme.space[8] }}>
            <Button label={t('settings.unpair')} variant="secondary" busy={unpairing} onPress={confirmUnpair} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 },
  value: { flexShrink: 1, textAlign: 'right' },
  actions: { flexDirection: 'row' },
  start: { alignSelf: 'flex-start' },
});

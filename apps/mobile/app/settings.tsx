import { router } from 'expo-router';
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { describeError, usePaired } from '../src/core/BrotProvider';
import { connectionLabel, shortTime } from '../src/format';
import { normalizeServerUrl } from '../src/pairing/payload';
import { registerForPush, type PushRegistration } from '../src/push/push';
import { ROLE_LABELS } from '../src/state/roles';
import { useTheme } from '../src/theme/ThemeProvider';
import { Button } from '../src/ui/Button';
import { Field } from '../src/ui/Field';
import { Header, Screen, SectionLabel } from '../src/ui/Screen';
import { Text } from '../src/ui/Text';

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

export default function SettingsScreen(): ReactElement | null {
  const paired = usePaired();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [editing, setEditing] = useState(false);
  const [address, setAddress] = useState(paired?.session.serverUrl ?? '');
  const [addressError, setAddressError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [unpairing, setUnpairing] = useState(false);
  const [push, setPush] = useState<PushRegistration>();

  useEffect(() => {
    void registerForPush().then(setPush);
  }, []);

  if (!paired) return null;
  const { session } = paired;
  const role = ROLE_LABELS[session.role];

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
      ? 'Your computer will stop accepting this phone. You can pair it again any time.'
      : 'This phone forgets your computer. Its access stays listed in Settings → Devices on your computer until you revoke it there.';
    Alert.alert('Unpair this phone?', detail, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unpair',
        style: 'destructive',
        onPress: () => {
          setUnpairing(true);
          void paired
            .unpair()
            .then(({ revokedOnServer }) => {
              if (!revokedOnServer && paired.capabilities.revokeSelf) {
                Alert.alert('Unpaired on this phone', 'Your computer was out of reach. Revoke this phone in Settings → Devices when it’s back.');
              }
            })
            .finally(() => setUnpairing(false));
        },
      },
    ]);
  };

  return (
    <Screen>
      <Header title="Settings" onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, theme.space[6]) + theme.space[6] }} keyboardShouldPersistTaps="handled">
          <SectionLabel>Computer</SectionLabel>
          {editing ? (
            <View style={{ marginHorizontal: theme.space[4], gap: theme.space[3] }}>
              <Field
                label="Address"
                value={address}
                onChangeText={setAddress}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                mono
                error={addressError}
                hint="Brot checks that this phone is still paired there before saving."
              />
              <View style={[styles.actions, { gap: theme.space[2] }]}>
                <Button
                  label="Cancel"
                  variant="secondary"
                  style={styles.flex}
                  disabled={saving}
                  onPress={() => {
                    setEditing(false);
                    setAddress(session.serverUrl);
                    setAddressError(undefined);
                  }}
                />
                <Button label="Save" style={styles.flex} busy={saving} onPress={() => void saveAddress()} />
              </View>
            </View>
          ) : (
            <>
              <Group>
                <Row label="Address" value={session.serverUrl} mono />
                <Row label="Status" value={connectionLabel(paired.liveStatus, paired.lastEventAt)} last />
              </Group>
              <View style={{ marginHorizontal: theme.space[4], marginTop: theme.space[2] }}>
                <Button label="Change address" variant="ghost" size="sm" onPress={() => setEditing(true)} style={styles.start} />
              </View>
            </>
          )}

          <SectionLabel>This phone</SectionLabel>
          <Group>
            <Row label="Name" value={session.deviceName} />
            <Row label="Role" value={role.title} />
            <Row label="Paired" value={shortTime(session.pairedAt)} last />
          </Group>
          <Text variant="meta" tone="ink2" style={{ marginHorizontal: theme.space[4], marginTop: theme.space[2] }}>
            {role.detail}
          </Text>

          <SectionLabel>Notifications</SectionLabel>
          <Group>
            <Row label="Push" value={push?.status === 'registered' ? 'On' : 'Not yet available'} last />
          </Group>
          {push?.status === 'unavailable' ? (
            <Text variant="meta" tone="ink2" style={{ marginHorizontal: theme.space[4], marginTop: theme.space[2] }}>
              {push.reason}
            </Text>
          ) : null}

          <View style={{ marginHorizontal: theme.space[4], marginTop: theme.space[8] }}>
            <Button label="Unpair this phone" variant="secondary" busy={unpairing} onPress={confirmUnpair} />
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

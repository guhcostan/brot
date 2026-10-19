import { DeviceRole } from '@brot/protocol';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import * as Device from 'expo-device';
import * as Haptics from 'expo-haptics';
import { useRef, useState, type ReactElement } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { describeError, useBrot } from '../src/core/BrotProvider';
import { BotAvatar, BrandMark } from '../src/avatar/BotAvatar';
import { normalizeServerUrl, parsePairingCode, type PairingTarget } from '../src/pairing/payload';
import { ROLE_LABELS } from '../src/state/roles';
import { riseIn } from '../src/theme/motion';
import { useTheme } from '../src/theme/ThemeProvider';
import { Button } from '../src/ui/Button';
import { Field } from '../src/ui/Field';
import { Icon } from '../src/ui/Icon';
import { Screen } from '../src/ui/Screen';
import { Text } from '../src/ui/Text';

type Step = { kind: 'scan' } | { kind: 'code' } | { kind: 'confirm'; target: PairingTarget };

function Scanner({ onCode, onManual }: { onCode: (raw: string) => void; onManual: () => void }): ReactElement {
  const theme = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const handled = useRef(false);

  const onScanned = (result: BarcodeScanningResult) => {
    if (handled.current) return;
    handled.current = true;
    onCode(result.data);
    setTimeout(() => {
      handled.current = false;
    }, 1500);
  };

  const frame = [styles.frame, { borderRadius: theme.radius.xl, backgroundColor: theme.color.surface2, borderColor: theme.color.line }];

  if (!permission) return <View style={frame} />;

  if (!permission.granted) {
    return (
      <View style={[frame, styles.frameCenter, { padding: theme.space[6], gap: theme.space[4] }]}>
        <Icon name="scan" size={32} tone="ink2" />
        <Text variant="small" tone="ink2" style={styles.center}>
          {permission.canAskAgain ? 'Brot needs the camera to scan the pairing code.' : 'Camera access is off. Turn it on in Settings, or enter the code instead.'}
        </Text>
        {permission.canAskAgain ? <Button label="Allow camera" size="sm" onPress={() => void requestPermission()} /> : null}
        <Button label="Enter code instead" size="sm" variant="ghost" onPress={onManual} />
      </View>
    );
  }

  return (
    <View style={frame}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={onScanned}
        accessibilityLabel="Camera viewfinder. Point it at the pairing code on your computer."
      />
    </View>
  );
}

function RoleOption({ role, selected, onSelect }: { role: DeviceRole; selected: boolean; onSelect: () => void }): ReactElement {
  const theme = useTheme();
  const c = theme.color;
  const label = ROLE_LABELS[role];
  return (
    <Pressable
      onPress={onSelect}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${label.title}. ${label.detail}`}
      style={[
        styles.role,
        {
          gap: theme.space[3],
          padding: theme.space[3],
          borderRadius: theme.radius.md,
          borderColor: selected ? c.ink : c.line,
          backgroundColor: selected ? c.surface2 : c.surface,
        },
      ]}
    >
      <View style={[styles.radio, { borderColor: selected ? c.ink : c.ink3 }]}>{selected ? <View style={[styles.radioDot, { backgroundColor: c.ink }]} /> : null}</View>
      <View style={styles.flex}>
        <Text variant="label">{label.title}</Text>
        <Text variant="meta" tone="ink2">
          {label.detail}
        </Text>
      </View>
    </Pressable>
  );
}

export default function PairScreen(): ReactElement {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { pair } = useBrot();
  const [step, setStep] = useState<Step>({ kind: 'scan' });
  const [scanError, setScanError] = useState<string>();
  const [code, setCode] = useState('');
  const [address, setAddress] = useState('');
  const [addressError, setAddressError] = useState<string>();
  const [deviceName, setDeviceName] = useState(Device.deviceName ?? Device.modelName ?? 'Phone');
  const [role, setRole] = useState<DeviceRole>('full');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();

  const accept = (raw: string) => {
    const parsed = parsePairingCode(raw);
    if (!parsed.ok) {
      setScanError(parsed.error);
      return;
    }
    void Haptics.selectionAsync();
    setScanError(undefined);
    setFailure(undefined);
    setAddress(parsed.value.serverUrl ?? '');
    setStep({ kind: 'confirm', target: parsed.value });
  };

  const submit = async (target: PairingTarget) => {
    const url = normalizeServerUrl(address, target.port);
    if (!url.ok) {
      setAddressError(url.error);
      return;
    }
    setAddressError(undefined);
    setFailure(undefined);
    setBusy(true);
    try {
      await pair({ serverUrl: url.value, token: target.token, deviceName: deviceName.trim() || 'Phone', role });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (cause) {
      const message = describeError(cause);
      setFailure(/expired|invalid/i.test(message) ? 'That code has expired. Show a new one on your computer and scan again.' : message);
    } finally {
      setBusy(false);
    }
  };

  const pad = { paddingHorizontal: theme.space[6], paddingBottom: Math.max(insets.bottom, theme.space[6]), gap: theme.space[6] };

  return (
    <Screen>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={[pad, { paddingTop: theme.space[8] }]} keyboardShouldPersistTaps="handled">
          <View style={{ gap: theme.space[3] }}>
            <View style={[styles.row, { gap: theme.space[2] }]}>
              <BrandMark size={32} />
              <BotAvatar shape="cloud" color="teal" mood="idle" size={32} />
              <BotAvatar shape="drop" color="amber" mood="idle" size={32} />
            </View>
            <Text variant="display" accessibilityRole="header">
              Pair this phone
            </Text>
            <Text variant="body" tone="ink2">
              On your computer, open Settings → Devices → Pair phone. The code works for two minutes.
            </Text>
          </View>

          {step.kind === 'scan' ? (
            <Animated.View key="scan" entering={riseIn(reduced)} style={{ gap: theme.space[4] }}>
              <Scanner onCode={accept} onManual={() => setStep({ kind: 'code' })} />
              {scanError ? (
                <Text variant="small" tone="ink" accessibilityLiveRegion="polite">
                  {scanError}
                </Text>
              ) : null}
              <Button label="Enter code instead" variant="secondary" icon="keyboard" onPress={() => setStep({ kind: 'code' })} />
            </Animated.View>
          ) : null}

          {step.kind === 'code' ? (
            <Animated.View key="code" entering={riseIn(reduced)} style={{ gap: theme.space[4] }}>
              <Field
                label="Pairing code"
                hint="Paste the pairing text copied from your computer."
                value={code}
                onChangeText={setCode}
                autoCapitalize="none"
                autoCorrect={false}
                mono
                error={scanError}
              />
              <Button label="Continue" onPress={() => accept(code)} disabled={code.trim() === ''} />
              <Button label="Scan instead" variant="ghost" icon="scan" onPress={() => setStep({ kind: 'scan' })} />
            </Animated.View>
          ) : null}

          {step.kind === 'confirm' ? (
            <Animated.View key="confirm" entering={riseIn(reduced)} style={{ gap: theme.space[6] }}>
              <View style={{ gap: theme.space[4] }}>
                <Field
                  label="Computer address"
                  hint={step.target.serverUrl ? 'From the code. Change it if your computer has another address on this network.' : 'The code names this computer only as “localhost”. Enter its address on your network, like 192.168.1.20.'}
                  value={address}
                  onChangeText={setAddress}
                  placeholder={`192.168.1.20:${step.target.port}`}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  mono
                  error={addressError}
                />
                <Field label="Name for this phone" value={deviceName} onChangeText={setDeviceName} hint="Shown in Settings → Devices on your computer." />
              </View>
              <View style={{ gap: theme.space[2] }} accessibilityRole="radiogroup" accessibilityLabel="What this phone can do">
                <Text variant="label">What this phone can do</Text>
                {DeviceRole.options.map((option) => (
                  <RoleOption key={option} role={option} selected={role === option} onSelect={() => setRole(option)} />
                ))}
              </View>
              {failure ? (
                <Text variant="small" tone="ink" accessibilityLiveRegion="assertive">
                  {failure}
                </Text>
              ) : null}
              <View style={{ gap: theme.space[2] }}>
                <Button label="Pair" onPress={() => void submit(step.target)} busy={busy} />
                <Button label="Scan another code" variant="ghost" onPress={() => setStep({ kind: 'scan' })} disabled={busy} />
              </View>
            </Animated.View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  row: { flexDirection: 'row', alignItems: 'center' },
  center: { textAlign: 'center' },
  frame: { width: '100%', aspectRatio: 1, overflow: 'hidden', borderWidth: 1 },
  frameCenter: { alignItems: 'center', justifyContent: 'center' },
  role: { flexDirection: 'row', alignItems: 'center', borderWidth: 1 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
});

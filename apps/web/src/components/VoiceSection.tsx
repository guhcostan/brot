import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { Button, Input } from '@brot/ui';
import type { VoiceInfo, VoiceProvider } from '../voice';
import { DEFAULT_SYSTEM_VOICE } from '../voice';
import { playAudioBlob, type AudioPlayback } from '../voicePlayer';
import { t } from '../i18n';
import { useClient } from './client';

export interface VoiceSectionProps {
  /** Voice state to render before the client load resolves, e.g. in an SSR render. */
  initialStatus?: VoiceInfo;
  /** Secret names to render before the client load resolves, e.g. in an SSR render. */
  initialSecretNames?: string[];
  /** Tells the app the voice availability may have changed (listen buttons refresh). */
  onChanged?: () => void;
}

interface VoiceFormState {
  provider: VoiceProvider;
  voice: string;
  baseUrl: string;
  model: string;
  secretName: string;
}

const fromSettings = (settings: VoiceInfo['settings'] | undefined): VoiceFormState => ({
  provider: settings?.provider ?? 'system',
  voice: settings?.voice ?? DEFAULT_SYSTEM_VOICE,
  baseUrl: settings?.baseUrl ?? '',
  model: settings?.model ?? '',
  secretName: settings?.secretName ?? '',
});

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Settings → Voice: the provider, the key saved in the vault (write-only), availability and a test. */
export function VoiceSection({ initialStatus, initialSecretNames, onChanged }: VoiceSectionProps): ReactElement {
  const client = useClient();
  const [status, setStatus] = useState<VoiceInfo | null>(initialStatus ?? null);
  const [secretNames, setSecretNames] = useState<string[]>(initialSecretNames ?? []);
  const [form, setForm] = useState<VoiceFormState>(() => fromSettings(initialStatus?.settings));
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState<'save' | 'key' | 'test' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [testPlaying, setTestPlaying] = useState(false);
  const playback = useRef<AudioPlayback | null>(null);
  const set = <K extends keyof VoiceFormState>(name: K, value: VoiceFormState[K]) => setForm((current) => ({ ...current, [name]: value }));

  const load = useCallback(async () => {
    const next = await client.getVoiceSettings();
    setStatus(next);
    setForm(fromSettings(next.settings));
    setSecretNames(await client.listSecretNames().catch(() => []));
  }, [client]);

  useEffect(() => {
    load().catch((cause: unknown) => setError(messageOf(cause)));
  }, [load]);

  useEffect(
    () => () => {
      playback.current?.stop();
      playback.current = null;
    },
    [],
  );

  const compatible = form.provider === 'openai-compatible';
  const keyName = form.secretName.trim();
  const keySaved = keyName !== '' && secretNames.includes(keyName);

  const save = async () => {
    if (compatible && (form.baseUrl.trim() === '' || form.model.trim() === '' || keyName === '')) {
      setError(t('settings.voiceInvalid'));
      return;
    }
    setBusy('save');
    setError(null);
    setNotice(null);
    try {
      await client.updateVoiceSettings({
        provider: form.provider,
        voice: form.voice.trim() === '' ? DEFAULT_SYSTEM_VOICE : form.voice.trim(),
        ...(compatible ? { baseUrl: form.baseUrl.trim(), model: form.model.trim(), secretName: keyName } : {}),
      });
      await load();
      setNotice(t('settings.voiceSaved'));
      onChanged?.();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(null);
    }
  };

  const saveKey = async () => {
    if (keyName === '' || key.trim() === '') {
      setError(t('settings.voiceInvalid'));
      return;
    }
    setBusy('key');
    setError(null);
    setNotice(null);
    try {
      await client.setSecret(keyName, key.trim());
      setKey('');
      setSecretNames(await client.listSecretNames());
      setStatus(await client.getVoiceSettings());
      onChanged?.();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy('test');
    setError(null);
    setNotice(null);
    try {
      const file = await client.speakText(t('settings.voiceTestSample'));
      const handle = playAudioBlob(file.blob);
      if (handle === null) {
        setError(t('voice.playUnsupported'));
        return;
      }
      playback.current?.stop();
      playback.current = handle;
      setTestPlaying(true);
      void handle.ended.then(() => {
        if (playback.current === handle) {
          playback.current = null;
          setTestPlaying(false);
        }
      });
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1 p-0 text-sm font-medium">{t('settings.voiceProvider')}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(['system', 'openai-compatible'] as const).map((provider) => (
            <label
              key={provider}
              className={
                form.provider === provider
                  ? 'flex cursor-pointer flex-col gap-1 rounded-lg border border-ink bg-surface-2 p-3'
                  : 'flex cursor-pointer flex-col gap-1 rounded-lg border border-line p-3 transition-colors duration-[var(--dur-fast)] hover:bg-surface-2'
              }
            >
              <span className="flex items-center gap-2">
                <input type="radio" name="voice-provider" className="room-check" checked={form.provider === provider} onChange={() => set('provider', provider)} />
                <span className="text-sm font-medium">{t(provider === 'system' ? 'settings.voiceProviderSystem' : 'settings.voiceProviderCompatible')}</span>
              </span>
              <span className="text-xs text-ink-2">{t(provider === 'system' ? 'settings.voiceProviderSystemHint' : 'settings.voiceProviderCompatibleHint')}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {compatible ? (
        <>
          <Input
            label={t('settings.voiceBaseUrl')}
            placeholder={t('settings.voiceBaseUrlPlaceholder')}
            value={form.baseUrl}
            spellCheck={false}
            autoComplete="off"
            className="font-mono"
            onChange={(event) => set('baseUrl', event.target.value)}
          />
          <Input
            label={t('settings.voiceModel')}
            placeholder={t('settings.voiceModelPlaceholder')}
            value={form.model}
            spellCheck={false}
            autoComplete="off"
            className="font-mono"
            onChange={(event) => set('model', event.target.value)}
          />
          <Input
            label={t('settings.voiceSecretName')}
            hint={t('settings.voiceSecretNameHint')}
            placeholder="openai_api_key"
            value={form.secretName}
            spellCheck={false}
            autoComplete="off"
            className="font-mono"
            onChange={(event) => set('secretName', event.target.value)}
          />
          <Input
            label={t('settings.voiceKey')}
            hint={keySaved ? t('settings.voiceKeySaved') : t('settings.voiceKeyMissing')}
            placeholder={t('settings.voiceKeyPlaceholder')}
            value={key}
            type="password"
            autoComplete="new-password"
            onChange={(event) => setKey(event.target.value)}
          />
          <div>
            <Button variant="secondary" size="sm" onClick={() => void saveKey()} disabled={busy !== null}>
              {t('settings.voiceSaveKey')}
            </Button>
          </div>
          <Input
            label={t('settings.voiceSystemVoice')}
            hint={t('settings.voiceSystemVoiceHint')}
            placeholder={DEFAULT_SYSTEM_VOICE}
            value={form.voice}
            onChange={(event) => set('voice', event.target.value)}
          />
        </>
      ) : (
        <Input
          label={t('settings.voiceSystemVoice')}
          hint={t('settings.voiceSystemVoiceHint')}
          placeholder={DEFAULT_SYSTEM_VOICE}
          value={form.voice}
          onChange={(event) => set('voice', event.target.value)}
        />
      )}

      <p className="m-0 text-sm text-ink-2" role="status">
        {status === null
          ? t('app.loading')
          : status.available
            ? t('settings.voiceAvailable')
            : t('settings.voiceUnavailable', { reason: status.reason ?? t('voice.unavailable') })}
      </p>

      {error !== null ? (
        <p role="alert" className="m-0 text-sm text-attention-text">
          {error}
        </p>
      ) : null}
      {notice !== null ? <p className="m-0 text-sm text-ink-2">{notice}</p> : null}

      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="sm" onClick={() => void save()} disabled={busy !== null}>
          {t('settings.voiceSave')}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => void test()} disabled={busy !== null}>
          {testPlaying || busy === 'test' ? t('settings.voiceTestPlaying') : t('settings.voiceTest')}
        </Button>
      </div>
    </div>
  );
}

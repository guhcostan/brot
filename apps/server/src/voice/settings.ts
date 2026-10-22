import type { Repos } from '@brot/db';
import { VoiceSettings, type UpdateVoiceSettings } from '@brot/protocol';

/** The settings key the voice configuration lives under. */
export const VOICE_SETTINGS_KEY = 'voice';

/** What the server uses before anyone saves settings: the macOS voice and the `tts` vault secret. */
export const DEFAULT_VOICE_SETTINGS: VoiceSettings = { provider: 'system', voice: '', secretName: 'tts' };

/** The stored voice settings, or the built-in defaults. */
export async function getVoiceSettings(repos: Pick<Repos, 'settings'>): Promise<VoiceSettings> {
  const stored = await repos.settings.get(VOICE_SETTINGS_KEY, VoiceSettings);
  return stored ?? { ...DEFAULT_VOICE_SETTINGS };
}

/**
 * Merges an update over the current settings and stores it. Switching provider with no voice keeps the
 * current voice only when the provider did not change; otherwise the new provider's default is used.
 */
export async function saveVoiceSettings(
  repos: Pick<Repos, 'settings'>,
  update: UpdateVoiceSettings,
): Promise<VoiceSettings> {
  const current = await getVoiceSettings(repos);
  const settings = VoiceSettings.parse({
    provider: update.provider,
    voice: update.voice ?? (update.provider === current.provider ? current.voice : ''),
    ...(update.model === undefined ? {} : { model: update.model }),
    ...(update.baseUrl === undefined ? {} : { baseUrl: update.baseUrl }),
    secretName: update.secretName ?? current.secretName,
    updatedAt: new Date().toISOString(),
  });
  await repos.settings.set(VOICE_SETTINGS_KEY, settings);
  return settings;
}

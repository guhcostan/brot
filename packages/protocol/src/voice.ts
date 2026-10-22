import { z } from 'zod';
import { IsoDateTime } from './entities';

/** How the server turns text into speech. `system` uses the macOS `say` command; the other posts to a server. */
export const VoiceProvider = z.enum(['system', 'openai-compatible']);
export type VoiceProvider = z.infer<typeof VoiceProvider>;

export const VoiceSecretName = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/, 'Use letters, digits, dot, dash or underscore');
export type VoiceSecretName = z.infer<typeof VoiceSecretName>;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * The TTS server URL: https anywhere, or http on loopback (a local server). Credentials, query strings and
 * fragments are refused, so an API key never lands in the stored URL. Same rule as a model provider's base URL.
 */
export const VoiceBaseUrl = z
  .url({ protocol: /^https?$/ })
  .refine((value) => {
    const url = new URL(value);
    if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') return false;
    return url.protocol === 'https:' || LOOPBACK_HOSTS.has(url.hostname);
  }, 'baseUrl must be https (or loopback http) with no credentials, query or fragment');
export type VoiceBaseUrl = z.infer<typeof VoiceBaseUrl>;

function requireServerConfig(
  value: { provider: VoiceProvider; baseUrl?: string | undefined; model?: string | undefined },
  ctx: z.RefinementCtx,
): void {
  if (value.provider !== 'openai-compatible') return;
  if (value.baseUrl === undefined) {
    ctx.addIssue({ code: 'custom', path: ['baseUrl'], message: 'an openai-compatible voice provider needs a baseUrl' });
  }
  if (value.model === undefined) {
    ctx.addIssue({ code: 'custom', path: ['model'], message: 'an openai-compatible voice provider needs a model' });
  }
}

/**
 * The server's speech settings, as the API returns them. It never carries the API key: `secretName` names the
 * vault secret the speak call reads. `updatedAt` is absent for the built-in defaults.
 */
export const VoiceSettings = z
  .object({
    provider: VoiceProvider,
    /** The provider's voice name. Empty uses the provider's default. */
    voice: z.string().max(80),
    model: z.string().min(1).max(120).optional(),
    baseUrl: VoiceBaseUrl.optional(),
    /** The vault secret holding the TTS API key. Defaults to `tts`. Never the key itself. */
    secretName: VoiceSecretName.default('tts'),
    updatedAt: IsoDateTime.optional(),
  })
  .superRefine(requireServerConfig);
export type VoiceSettings = z.infer<typeof VoiceSettings>;

/** Replaces the speech settings. An openai-compatible server must name its baseUrl and model here. */
export const UpdateVoiceSettings = z
  .object({
    provider: VoiceProvider,
    voice: z.string().min(1).max(80).optional(),
    model: z.string().min(1).max(120).optional(),
    baseUrl: VoiceBaseUrl.optional(),
    secretName: VoiceSecretName.optional(),
  })
  .superRefine(requireServerConfig);
export type UpdateVoiceSettings = z.infer<typeof UpdateVoiceSettings>;

/** What POST /api/voice/speak speaks. */
export const VoiceSpeakRequest = z.object({
  text: z.string().min(1).max(2000),
});
export type VoiceSpeakRequest = z.infer<typeof VoiceSpeakRequest>;

/** What GET /api/voice returns: the settings and whether they can speak right now. */
export const VoiceInfo = z.object({
  settings: VoiceSettings,
  available: z.boolean(),
  reason: z.string().optional(),
});
export type VoiceInfo = z.infer<typeof VoiceInfo>;

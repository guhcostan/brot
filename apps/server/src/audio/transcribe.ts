import type { Repos } from '@brot/db';
import { ATTACHMENT_MAX_BYTES, IsoDateTime } from '@brot/protocol';
import { z } from 'zod';
import type { ProviderRegistry, ProviderSpec } from '../llm';
import { parseModelRef, transcriptionTarget } from '../llm/providers';
import type { Vault } from '../vault';
import { errorMessage } from '../team/context';

/** The settings key the speech-to-text configuration lives under. */
export const TRANSCRIPTION_SETTINGS_KEY = 'transcription';
/** One transcription request may take this long before it is aborted. */
export const TRANSCRIPTION_TIMEOUT_MS = 60_000;
/** At most this many audio attachments of one message are transcribed per run. */
export const TRANSCRIPTION_MAX_AUDIO_ATTACHMENTS = 2;

/** The saved transcription model (`<provider>/<model>`), or none. */
export const TranscriptionSettings = z.object({
  model: z.string().min(1).optional(),
  updatedAt: IsoDateTime.optional(),
});
export type TranscriptionSettings = z.infer<typeof TranscriptionSettings>;

/** Saving the transcription model. `null` removes it, which turns transcription off. */
export const UpdateTranscriptionSettings = z.object({ model: z.string().min(1).nullable() });
export type UpdateTranscriptionSettings = z.infer<typeof UpdateTranscriptionSettings>;

/** The stored settings, or an empty object when transcription was never configured. */
export async function getTranscriptionSettings(repos: Pick<Repos, 'settings'>): Promise<TranscriptionSettings> {
  return (await repos.settings.get(TRANSCRIPTION_SETTINGS_KEY, TranscriptionSettings)) ?? {};
}

export async function saveTranscriptionSettings(
  repos: Pick<Repos, 'settings'>,
  update: UpdateTranscriptionSettings,
): Promise<TranscriptionSettings> {
  const settings: TranscriptionSettings = {
    ...(update.model === null ? {} : { model: update.model }),
    updatedAt: new Date().toISOString(),
  };
  await repos.settings.set(TRANSCRIPTION_SETTINGS_KEY, settings);
  return settings;
}

/** Outbound HTTP for an OpenAI-compatible audio server. Tests inject a fake. */
export type TranscriptionFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface TranscribeDeps {
  repos: Pick<Repos, 'settings'>;
  providers: ProviderRegistry;
  vault: Pick<Vault, 'has' | 'resolveRef'>;
  /** Test seam; production uses the global fetch. */
  fetch?: TranscriptionFetch;
  timeoutMs?: number;
  /** Test seam; production logs the reason with console.warn. */
  log?: (line: string) => void;
}

/** One audio attachment to transcribe. The bytes stay in memory and are never logged. */
export interface AudioToTranscribe {
  bytes: Uint8Array;
  mimeType: string;
  filename: string;
}

export type ResolvedTranscription =
  | { ok: true; provider: ProviderSpec; model: string }
  | { ok: false; reason: string };

/**
 * The configured model resolved through the provider registry: the provider must exist, speak the
 * openai-completions API and list the model with `transcription: true`. Reason-only failures, no key or bytes.
 */
export function resolveTranscription(providers: ProviderRegistry, modelRef: string | undefined): ResolvedTranscription {
  if (modelRef === undefined || modelRef.trim() === '') return { ok: false, reason: 'no transcription model is configured' };
  let ref;
  try {
    ref = parseModelRef(modelRef);
  } catch {
    return { ok: false, reason: `"${modelRef}" is not a <provider>/<model> reference` };
  }
  const target = transcriptionTarget(providers, ref);
  if (target !== undefined) return { ok: true, ...target };
  const provider = providers.get(ref.provider);
  if (provider === undefined) return { ok: false, reason: `unknown model provider "${ref.provider}"` };
  if (provider.api !== 'openai-completions') {
    return { ok: false, reason: `provider "${provider.id}" does not use the openai-completions API` };
  }
  if (provider.models?.some((entry) => entry.id === ref.model) !== true) {
    return { ok: false, reason: `model "${modelRef}" is not listed by provider "${provider.id}"` };
  }
  return { ok: false, reason: `model "${modelRef}" does not set transcription: true` };
}

/** Whether the saved transcription model can be used right now: model resolves and the vault holds its key. */
export async function transcriptionAvailability(
  deps: Pick<TranscribeDeps, 'repos' | 'providers' | 'vault'>,
): Promise<{ available: boolean; reason?: string }> {
  const settings = await getTranscriptionSettings(deps.repos);
  const resolved = resolveTranscription(deps.providers, settings.model);
  if (!resolved.ok) return { available: false, reason: resolved.reason };
  if (!(await deps.vault.has(resolved.provider.secretName))) {
    return { available: false, reason: `Add a "${resolved.provider.secretName}" secret with the transcription API key.` };
  }
  return { available: true };
}

/**
 * Transcribes one audio attachment with the configured model through an OpenAI-compatible
 * `POST <baseUrl>/audio/transcriptions` (multipart `model` and `file`, bearer key from the vault at call time).
 * The audio bytes and the key never reach a log or an error: every failure returns undefined and logs the reason.
 */
export async function transcribeAudio(deps: TranscribeDeps, audio: AudioToTranscribe): Promise<string | undefined> {
  const log = deps.log ?? ((line: string) => console.warn(`transcription: ${line}`));
  const settings = await getTranscriptionSettings(deps.repos);
  const resolved = resolveTranscription(deps.providers, settings.model);
  if (!resolved.ok) {
    log(`skipped: ${resolved.reason}`);
    return undefined;
  }
  if (audio.bytes.byteLength === 0) {
    log('skipped: the audio is empty');
    return undefined;
  }
  if (audio.bytes.byteLength > ATTACHMENT_MAX_BYTES) {
    log(`skipped: the audio is over the ${ATTACHMENT_MAX_BYTES / (1024 * 1024)} MiB limit`);
    return undefined;
  }
  const key = await deps.vault.resolveRef(`secret://${resolved.provider.secretName}`);
  if (key === undefined) {
    log(`skipped: the vault has no "${resolved.provider.secretName}" secret`);
    return undefined;
  }

  const form = new FormData();
  form.set('model', resolved.model);
  form.set('file', new File([new Uint8Array(audio.bytes)], audio.filename, { type: audio.mimeType }));
  form.set('response_format', 'json');

  const send = deps.fetch ?? ((url: string, init: RequestInit) => fetch(url, init));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? TRANSCRIPTION_TIMEOUT_MS);
  timer.unref?.();
  try {
    const response = await send(`${resolved.provider.baseUrl.replace(/\/+$/, '')}/audio/transcriptions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}` },
      body: form,
      signal: controller.signal,
    });
    if (!response.ok) {
      log(`skipped: the provider answered ${response.status}`);
      return undefined;
    }
    const body = (await response.json().catch(() => undefined)) as unknown;
    const text =
      typeof body === 'object' && body !== null && 'text' in body && typeof (body as { text?: unknown }).text === 'string'
        ? (body as { text: string }).text.trim()
        : '';
    if (text === '') {
      log('skipped: the provider returned no text');
      return undefined;
    }
    return text;
  } catch (error) {
    log(`skipped: the request failed (${errorMessage(error)})`);
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

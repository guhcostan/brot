import type { VoiceSettings } from '@brot/protocol';
import type { Vault } from '../vault';
import { binaryAvailable, type BinaryCheck } from './spawn';

/** Whether the configured provider can speak right now, and why not when it cannot. */
export interface VoiceAvailability {
  available: boolean;
  reason?: string;
}

export interface AvailabilityDeps {
  vault: Pick<Vault, 'has'>;
  hasBinary?: BinaryCheck;
  platform?: NodeJS.Platform;
}

/**
 * A cheap capability probe for GET /api/voice. It never runs a command or makes a request: for the system
 * provider it checks the platform and that `say` exists; for the other, that the server is configured and the
 * vault holds the named secret.
 */
export async function voiceAvailability(
  settings: VoiceSettings,
  deps: AvailabilityDeps,
): Promise<VoiceAvailability> {
  if (settings.provider === 'system') {
    if ((deps.platform ?? process.platform) !== 'darwin') {
      return {
        available: false,
        reason: 'System speech is only available on macOS; configure an OpenAI-compatible TTS server instead.',
      };
    }
    const hasBinary = deps.hasBinary ?? binaryAvailable;
    if (!(await hasBinary('say'))) return { available: false, reason: 'The macOS "say" command is not available.' };
    return { available: true };
  }

  if (settings.baseUrl === undefined || settings.model === undefined) {
    return { available: false, reason: 'Set a base URL and a model for the speech server.' };
  }
  if (!(await deps.vault.has(settings.secretName))) {
    return { available: false, reason: `Add a "${settings.secretName}" secret with the speech API key.` };
  }
  return { available: true };
}

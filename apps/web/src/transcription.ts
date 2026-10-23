/** The model that transcribes audio attachments before a run; absent means none is configured. */
export interface TranscriptionSettings {
  model?: string;
  updatedAt?: string;
}

/** `GET /api/transcription`: the settings plus whether the configured model can be reached. */
export interface TranscriptionStatus {
  settings: TranscriptionSettings;
  available: boolean;
  reason?: string;
}

/** `PUT /api/transcription`: a model ref sets it, null clears it. */
export interface UpdateTranscriptionSettings {
  model: string | null;
}

/** Only models the provider explicitly flags as transcription-capable can be chosen. */
export function modelSupportsTranscription(model: { transcription?: boolean }): boolean {
  return model.transcription === true;
}

/** Reads a transcription status without trusting it; malformed pieces become empty. */
export function parseTranscriptionStatus(value: unknown): TranscriptionStatus {
  const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const settings = typeof record.settings === 'object' && record.settings !== null ? (record.settings as Record<string, unknown>) : {};
  return {
    settings: {
      ...(typeof settings.model === 'string' && settings.model !== '' ? { model: settings.model } : {}),
      ...(typeof settings.updatedAt === 'string' ? { updatedAt: settings.updatedAt } : {}),
    },
    available: record.available === true,
    ...(typeof record.reason === 'string' ? { reason: record.reason } : {}),
  };
}

/** Validates a PUT body before sending: null clears, a non-empty model ref sets it. */
export function validateUpdateTranscriptionSettings(input: UpdateTranscriptionSettings): UpdateTranscriptionSettings {
  if (input.model !== null && (typeof input.model !== 'string' || input.model.trim() === '')) {
    throw new Error('A transcription model must be <provider>/<model>, or null to clear it');
  }
  return { model: input.model === null ? null : input.model.trim() };
}

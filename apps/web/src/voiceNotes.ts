/** MediaRecorder mime candidates, in preference order: Opus webm first, then MP4 for Safari. */
export const VOICE_NOTE_MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'] as const;

export type MediaRecorderConstructor = typeof MediaRecorder;

/** Looks MediaRecorder up at call time; undefined in SSR and browsers without it. */
export function getMediaRecorder(scope: unknown = globalThis): MediaRecorderConstructor | undefined {
  if (typeof scope !== 'object' || scope === null) return undefined;
  const candidate = (scope as { MediaRecorder?: unknown }).MediaRecorder;
  return typeof candidate === 'function' ? (candidate as MediaRecorderConstructor) : undefined;
}

/** Recording needs both MediaRecorder and getUserMedia; checked at click time, never at render. */
export function canRecordVoice(scope: unknown = globalThis): boolean {
  const recorder = getMediaRecorder(scope);
  if (recorder === undefined) return false;
  if (typeof scope !== 'object' || scope === null) return false;
  const navigator = (scope as { navigator?: { mediaDevices?: { getUserMedia?: unknown } } }).navigator;
  const getUserMedia = navigator?.mediaDevices?.getUserMedia;
  return typeof getUserMedia === 'function';
}

/** The first candidate the browser can record, or null when none are supported. */
export function pickVoiceNoteMime(isSupported: (mimeType: string) => boolean): string | null {
  return VOICE_NOTE_MIME_CANDIDATES.find((mimeType) => isSupported(mimeType)) ?? null;
}

/** The extension matching the recorded mime: webm for Opus/WebM, m4a for MP4. */
export function voiceNoteExtension(mimeType: string): 'webm' | 'm4a' {
  const base = (mimeType.split(';')[0] ?? '').trim().toLowerCase();
  return base === 'audio/mp4' ? 'm4a' : 'webm';
}

/** `voice-note-HH-MM-SS.webm` (or .m4a), built from the start time of the finished recording. */
export function voiceNoteFileName(at: Date, mimeType: string): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp = `${pad(at.getHours())}-${pad(at.getMinutes())}-${pad(at.getSeconds())}`;
  return `voice-note-${stamp}.${voiceNoteExtension(mimeType)}`;
}

/** Elapsed recording time: `0:07`, `1:05`, `1:00:05` past an hour. */
export function formatRecordingDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

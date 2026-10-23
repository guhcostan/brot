import type { Locale } from '../i18n';

/** The slice of SpeechRecognition the composer uses; the browser's implementation satisfies it. */
export interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechResultEventLike) => void) | null;
  onerror: ((event: SpeechErrorEventLike) => void) | null;
  onend: (() => void) | null;
}

export interface SpeechResultLike {
  readonly isFinal: boolean;
  readonly 0: { readonly transcript: string };
  readonly length: number;
}

export interface SpeechResultEventLike {
  readonly resultIndex: number;
  readonly results: { readonly length: number; readonly [index: number]: SpeechResultLike };
}

export interface SpeechErrorEventLike {
  readonly error: string;
}

export type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

/** Looks the Web Speech API up at call time; undefined when the browser (or SSR) has none. */
export function getSpeechRecognition(scope: unknown = globalThis): SpeechRecognitionConstructor | undefined {
  if (typeof scope !== 'object' || scope === null) return undefined;
  const record = scope as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  const candidate = record.SpeechRecognition ?? record.webkitSpeechRecognition;
  return typeof candidate === 'function' ? (candidate as SpeechRecognitionConstructor) : undefined;
}

/** The BCP-47 language the browser should listen in, from the app locale. */
export function speechLanguage(locale: Locale): string {
  if (locale === 'pt-BR') return 'pt-BR';
  if (locale === 'es') return 'es-ES';
  return 'en-US';
}

/** All final transcripts from a result event, joined. */
export function finalTranscript(event: SpeechResultEventLike): string {
  const parts: string[] = [];
  for (let index = 0; index < event.results.length; index += 1) {
    const result = event.results[index];
    if (result !== undefined && result.isFinal) parts.push(result[0].transcript);
  }
  return parts.join(' ').trim();
}

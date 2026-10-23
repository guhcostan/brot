import { describe, expect, it } from 'vitest';
import { finalTranscript, getSpeechRecognition, speechLanguage } from './dictation';

class FakeRecognition {
  readonly vendor = 'speech';
}
class FakeWebkitRecognition {
  readonly vendor = 'webkit';
}

describe('getSpeechRecognition', () => {
  it('finds either vendor name and ignores non-constructors', () => {
    expect(getSpeechRecognition({ SpeechRecognition: FakeRecognition })).toBe(FakeRecognition);
    expect(getSpeechRecognition({ webkitSpeechRecognition: FakeWebkitRecognition })).toBe(FakeWebkitRecognition);
    expect(getSpeechRecognition({ SpeechRecognition: 'nope' })).toBeUndefined();
    expect(getSpeechRecognition({})).toBeUndefined();
    expect(getSpeechRecognition(undefined)).toBeUndefined();
    expect(getSpeechRecognition(null)).toBeUndefined();
  });
});

describe('speechLanguage', () => {
  it('maps the app locale', () => {
    expect(speechLanguage('en')).toBe('en-US');
    expect(speechLanguage('pt-BR')).toBe('pt-BR');
    expect(speechLanguage('es')).toBe('es-ES');
  });
});

describe('finalTranscript', () => {
  it('joins final results and skips interim ones', () => {
    const event = {
      resultIndex: 0,
      results: {
        0: { isFinal: true, 0: { transcript: 'Hello' }, length: 1 },
        1: { isFinal: false, 0: { transcript: 'partial' }, length: 1 },
        2: { isFinal: true, 0: { transcript: 'there' }, length: 1 },
        length: 3,
      },
    };

    expect(finalTranscript(event)).toBe('Hello there');
    expect(finalTranscript({ resultIndex: 0, results: { length: 0 } })).toBe('');
  });
});

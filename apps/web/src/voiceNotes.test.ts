import { describe, expect, it } from 'vitest';
import { canRecordVoice, formatRecordingDuration, getMediaRecorder, pickVoiceNoteMime, voiceNoteExtension, voiceNoteFileName } from './voiceNotes';

describe('voice note mime selection', () => {
  it('prefers Opus WebM and falls back to MP4', () => {
    expect(pickVoiceNoteMime((mime) => mime === 'audio/webm;codecs=opus')).toBe('audio/webm;codecs=opus');
    expect(pickVoiceNoteMime((mime) => mime === 'audio/mp4')).toBe('audio/mp4');
    expect(pickVoiceNoteMime(() => false)).toBeNull();
  });

  it('maps the extension from the mime', () => {
    expect(voiceNoteExtension('audio/webm;codecs=opus')).toBe('webm');
    expect(voiceNoteExtension('audio/webm')).toBe('webm');
    expect(voiceNoteExtension('audio/mp4')).toBe('m4a');
  });
});

describe('voice note filenames', () => {
  it('stamps the local HH-MM-SS start time', () => {
    const at = new Date(2026, 9, 22, 9, 5, 3);
    expect(voiceNoteFileName(at, 'audio/webm;codecs=opus')).toBe('voice-note-09-05-03.webm');
    expect(voiceNoteFileName(at, 'audio/mp4')).toBe('voice-note-09-05-03.m4a');
  });
});

describe('formatRecordingDuration', () => {
  it('reads like a voice note timer', () => {
    expect(formatRecordingDuration(0)).toBe('0:00');
    expect(formatRecordingDuration(7)).toBe('0:07');
    expect(formatRecordingDuration(65)).toBe('1:05');
    expect(formatRecordingDuration(3605)).toBe('1:00:05');
    expect(formatRecordingDuration(-3)).toBe('0:00');
  });
});

describe('recorder feature detection', () => {
  it('needs both MediaRecorder and getUserMedia', () => {
    class Recorder {
      readonly vendor = 'fake';
    }
    expect(getMediaRecorder({ MediaRecorder: Recorder })).toBe(Recorder);
    expect(getMediaRecorder({ MediaRecorder: 'no' })).toBeUndefined();
    expect(canRecordVoice({ MediaRecorder: Recorder, navigator: { mediaDevices: { getUserMedia: async () => undefined } } })).toBe(true);
    expect(canRecordVoice({ MediaRecorder: Recorder })).toBe(false);
    expect(canRecordVoice({ navigator: { mediaDevices: { getUserMedia: async () => undefined } } })).toBe(false);
    expect(canRecordVoice(undefined)).toBe(false);
  });
});

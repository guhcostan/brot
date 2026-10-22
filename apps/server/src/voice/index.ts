export { voiceAvailability } from './availability';
export type { AvailabilityDeps, VoiceAvailability } from './availability';
export { DEFAULT_VOICE_SETTINGS, VOICE_SETTINGS_KEY, getVoiceSettings, saveVoiceSettings } from './settings';
export { VoiceUnavailableError, speak } from './speak';
export type { SpeakDeps, SpokenAudio, VoiceFetch, VoiceOptions } from './speak';
export { binaryAvailable, spawnSpeechRunner } from './spawn';
export type { BinaryCheck, SpeechCommandResult, SpeechRunner, SystemBinary } from './spawn';

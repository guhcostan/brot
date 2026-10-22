/**
 * Audio playback helpers, effect-only and SSR-safe: nothing here touches the DOM until a person clicks
 * Listen or a bot with auto-speak produces a reply. The player owns its object URL and revokes it on end/stop.
 */

export interface AudioPlayback {
  /** Ends playback and revokes the object URL. Safe to call twice. */
  stop: () => void;
  /** Resolves when the audio ends, errors, or is stopped. */
  ended: Promise<void>;
}

/** Whether this runtime can play generated audio. */
export function canPlayAudio(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof Audio !== 'undefined' &&
    typeof URL !== 'undefined' &&
    typeof URL.createObjectURL === 'function'
  );
}

/** Plays a blob through the browser's audio element; null when audio is unavailable. */
export function playAudioBlob(blob: Blob): AudioPlayback | null {
  if (!canPlayAudio()) return null;
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  let stopped = false;
  let resolveEnded: () => void = () => undefined;
  const ended = new Promise<void>((resolve) => {
    resolveEnded = resolve;
  });
  const revoke = () => {
    if (stopped) return;
    stopped = true;
    URL.revokeObjectURL(url);
  };
  const finish = () => {
    revoke();
    resolveEnded();
  };
  audio.addEventListener('ended', finish, { once: true });
  audio.addEventListener('error', finish, { once: true });
  void audio.play().catch(finish);
  return {
    stop: () => {
      audio.pause();
      audio.currentTime = 0;
      finish();
    },
    ended,
  };
}

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MessageItem, ThreadState } from '../state/thread';
import type { VoiceContext } from '../voice';
import { playAudioBlob, type AudioPlayback } from '../voicePlayer';

export interface AutoSpeakOptions {
  thread: ThreadState;
  /** Settings availability and the speak call; absent while the app is still loading them. */
  voice?: VoiceContext;
  /** The bot an assistant message without `authorBotId` belongs to (the DM's bot, or a room's lead). */
  defaultBotId?: string;
  /** Whether the bot that wrote a message wants its replies read aloud. */
  speaks: (botId: string | undefined) => boolean;
}

export interface AutoSpeakState {
  playing: boolean;
  /** Stops the current playback; the next completed reply still speaks. */
  stop: () => void;
}

/** The newest completed assistant message with text to read. */
export function newestSpokenMessage(items: ThreadState['items']): MessageItem | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.kind === 'message' && item.role === 'assistant' && !item.streaming && item.viaBotId === undefined && item.content.trim() !== '') {
      return item;
    }
  }
  return undefined;
}

/**
 * Reads new completed assistant replies aloud for bots whose `speakReplies` is on. History present at
 * mount is never spoken; each new message speaks once. Latest wins: a newer reply stops the previous one
 * instead of queueing, and a hidden tab skips the new reply (it stays seen, so it does not surprise later).
 */
export function useAutoSpeak({ thread, voice, defaultBotId, speaks }: AutoSpeakOptions): AutoSpeakState {
  const seen = useRef<Set<string> | null>(null);
  const playback = useRef<AudioPlayback | null>(null);
  const request = useRef(0);
  const [playing, setPlaying] = useState(false);
  const latest = newestSpokenMessage(thread.items);
  const latestId = latest?.id;

  const stop = useCallback(() => {
    request.current += 1;
    playback.current?.stop();
    playback.current = null;
    setPlaying(false);
  }, []);

  useEffect(() => {
    if (seen.current === null) {
      seen.current = new Set(latestId === undefined ? [] : [latestId]);
      return;
    }
    if (latestId === undefined || seen.current.has(latestId)) return;
    seen.current.add(latestId);
    if (latest === undefined || voice === undefined || voice.status?.available !== true) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    const botId = latest.authorBotId ?? defaultBotId;
    if (!speaks(botId)) return;
    const ticket = (request.current += 1);
    playback.current?.stop();
    playback.current = null;
    setPlaying(false);
    const text = latest.content;
    void (async () => {
      try {
        const file = await voice.speak(text);
        if (request.current !== ticket) return;
        const handle = playAudioBlob(file.blob);
        if (handle === null) return;
        playback.current = handle;
        setPlaying(true);
        await handle.ended;
        if (request.current === ticket) {
          playback.current = null;
          setPlaying(false);
        }
      } catch {
        if (request.current === ticket) setPlaying(false);
      }
    })();
  }, [latestId, latest, voice, defaultBotId, speaks]);

  useEffect(
    () => () => {
      playback.current?.stop();
      playback.current = null;
    },
    [],
  );

  return { playing, stop };
}

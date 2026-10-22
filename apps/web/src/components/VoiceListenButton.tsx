import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Button } from '@brot/ui';
import { t } from '../i18n';
import type { VoiceContext } from '../voice';
import { playAudioBlob, type AudioPlayback } from '../voicePlayer';
import { Speaker, SpeakerOff } from './icons';

export interface VoiceListenButtonProps {
  text: string;
  voice: VoiceContext;
}

/**
 * Plays one assistant reply. Clicking while it plays stops it; clicking again replaces it. The player
 * owns its object URL and every error stays inline under the button.
 */
export function VoiceListenButton({ text, voice }: VoiceListenButtonProps): ReactElement {
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const playback = useRef<AudioPlayback | null>(null);
  const available = voice.status?.available === true;
  const reason = voice.status?.reason ?? t('voice.unavailable');

  useEffect(
    () => () => {
      playback.current?.stop();
      playback.current = null;
    },
    [],
  );

  const toggle = async () => {
    if (loading) return;
    if (playing) {
      playback.current?.stop();
      playback.current = null;
      setPlaying(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const file = await voice.speak(text);
      const handle = playAudioBlob(file.blob);
      if (handle === null) {
        setError(t('voice.playUnsupported'));
        return;
      }
      playback.current = handle;
      setPlaying(true);
      void handle.ended.then(() => {
        if (playback.current === handle) {
          playback.current = null;
          setPlaying(false);
        }
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };

  return (
    <span className="flex flex-col items-start gap-0.5">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => void toggle()}
        disabled={!available || loading}
        aria-pressed={playing}
        aria-label={t(playing ? 'voice.stopListening' : 'voice.listen')}
        title={available ? t(playing ? 'voice.stopListening' : 'voice.listen') : reason}
        className="!min-h-6 !px-1.5 text-ink-3"
      >
        {loading ? (
          <span aria-hidden="true" className="size-3.5 animate-spin rounded-full border border-line border-t-ink motion-reduce:animate-none" />
        ) : playing ? (
          <SpeakerOff size={14} />
        ) : (
          <Speaker size={14} />
        )}
      </Button>
      {error !== null ? (
        <span role="alert" className="max-w-[280px] text-xs text-attention-text">
          {error}
        </span>
      ) : null}
    </span>
  );
}

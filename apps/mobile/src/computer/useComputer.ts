import { useIsFocused } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import type { ComputerInfo } from '../api/client';
import { describeError, usePaired } from '../core/BrotProvider';
import { useAppActive } from '../theme/useAppActive';
import { createScreenFeed, type FeedStatus } from './feed';

export interface ComputerView {
  info?: ComputerInfo;
  frame?: string;
  status: FeedStatus;
  /** Why the last action failed, in plain words. */
  error?: string;
  start(): Promise<void>;
}

/**
 * The live screen of a bot's desktop. It polls about twice a second only while this screen is
 * focused and the app is in the foreground, and stops otherwise (docs/COMPUTER-USE.md).
 */
export function useComputer(botId: string): ComputerView {
  const paired = usePaired();
  const client = paired?.client;
  const focused = useIsFocused();
  const active = useAppActive();
  const [info, setInfo] = useState<ComputerInfo>();
  const [frame, setFrame] = useState<string>();
  const [status, setStatus] = useState<FeedStatus>('loading');
  const [error, setError] = useState<string>();
  const live = status === 'live';

  // Reread state and takeover on open and each time the screen comes up, e.g. after a start.
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    client
      .getComputer(botId)
      .then((next) => {
        if (!cancelled) setInfo(next);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(describeError(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [client, botId, live]);

  useEffect(() => {
    if (!client || !focused || !active) return;
    const feed = createScreenFeed({
      fetchFrame: () => client.screen(botId),
      onFrame: setFrame,
      onStatus: setStatus,
    });
    feed.start();
    return () => feed.stop();
  }, [client, botId, focused, active]);

  const start = useCallback(async () => {
    if (!client) return;
    setError(undefined);
    try {
      setInfo(await client.startComputer(botId));
      setStatus('loading');
    } catch (cause) {
      setError(describeError(cause));
    }
  }, [client, botId]);

  return { info, frame, status, error, start };
}

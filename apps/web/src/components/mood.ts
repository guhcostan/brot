import { useEffect, useRef, useState } from 'react';
import { STATUS_MOOD, type AvatarMood, type BotStatus } from '@brot/ui';

const HAPPY_MS = 1700;

/**
 * A bot's avatar mood that reacts to its run: working eyes while it runs, wide eyes while it waits
 * for you, concerned on failure, and a happy hop for a moment when a run finishes well.
 */
export function useLiveMood(status: BotStatus): AvatarMood {
  const previous = useRef(status);
  const [happy, setHappy] = useState(false);

  useEffect(() => {
    const before = previous.current;
    previous.current = status;
    if ((before === 'working' || before === 'waiting') && (status === 'idle' || status === 'ok')) {
      setHappy(true);
      const timer = setTimeout(() => setHappy(false), HAPPY_MS);
      return () => clearTimeout(timer);
    }
    if (status !== 'idle') setHappy(false);
    return undefined;
  }, [status]);

  return happy ? 'success' : STATUS_MOOD[status];
}

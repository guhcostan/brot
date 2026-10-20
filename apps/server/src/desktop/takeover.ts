import type { SetTakeover, Takeover } from '@brot/protocol';

/** The message every bot browser or input tool returns while the person has control. */
export const TAKEOVER_REFUSAL = 'The person has control of the computer right now. Wait, or call request_takeover.';

/**
 * Who has the keyboard of each bot's desktop. The state lives in memory: a takeover does not outlive a server
 * restart, which is the safe direction (the bot has to ask again).
 */
export interface TakeoverState {
  get(botId: string): Takeover | null;
  isActive(botId: string): boolean;
  /** Records the new state and returns it. `at` is stamped now. */
  set(botId: string, change: SetTakeover & { requestedBy: 'bot' | 'user' }, now?: Date): Takeover;
}

export function createTakeoverState(): TakeoverState {
  const states = new Map<string, Takeover>();
  return {
    get: (botId) => states.get(botId) ?? null,
    isActive: (botId) => states.get(botId)?.active === true,
    set(botId, change, now = new Date()) {
      const takeover: Takeover = {
        botId,
        active: change.active,
        requestedBy: change.requestedBy,
        at: now.toISOString(),
        ...(change.reason === undefined ? {} : { reason: change.reason }),
      };
      states.set(botId, takeover);
      return takeover;
    },
  };
}

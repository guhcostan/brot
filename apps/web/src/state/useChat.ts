import { useCallback, useEffect, useReducer } from 'react';
import type { ApprovalDecision } from '@brot/protocol';
import type { BrotClient } from '../data/client';
import { appReducer, initialAppState } from './store';

/** Loads bots and history, then folds every live event into per-bot thread state. */
export function useChat(client: BrotClient) {
  const [state, dispatch] = useReducer(appReducer, initialAppState);

  useEffect(() => {
    let active = true;
    const stop = client.onEvent(({ botId, event }) => {
      if (active) dispatch({ type: 'event', botId, event });
    });

    client
      .listBots()
      .then(async (bots) => {
        if (!active) return;
        dispatch({ type: 'bots-loaded', bots });
        await Promise.all(
          bots.map(async (bot) => {
            const events = await client.history(bot.id);
            if (active) dispatch({ type: 'history-loaded', botId: bot.id, events });
          }),
        );
      })
      .catch((error: unknown) => {
        if (active) dispatch({ type: 'failed', message: error instanceof Error ? error.message : String(error) });
      });

    return () => {
      active = false;
      stop();
    };
  }, [client]);

  const select = useCallback((botId: string) => dispatch({ type: 'select', botId }), []);

  const send = useCallback((botId: string, content: string) => client.postMessage(botId, { content }), [client]);

  const decide = useCallback(
    (approvalId: string, decision: ApprovalDecision, reply?: string) =>
      client.resolveApproval(approvalId, reply ? { decision, reply } : { decision }),
    [client],
  );

  return { state, select, send, decide };
}

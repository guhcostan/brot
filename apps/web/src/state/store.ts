import type { Bot, CanonicalEvent } from '@brot/protocol';
import { applyEvent, emptyThread, foldEvents, type ThreadState } from './thread';

export interface AppState {
  bots: Bot[];
  selectedBotId: string | null;
  threads: Record<string, ThreadState>;
  ready: boolean;
  error: string | null;
}

export const initialAppState: AppState = {
  bots: [],
  selectedBotId: null,
  threads: {},
  ready: false,
  error: null,
};

export type AppAction =
  | { type: 'bots-loaded'; bots: Bot[] }
  | { type: 'history-loaded'; botId: string; events: CanonicalEvent[] }
  | { type: 'event'; botId: string; event: CanonicalEvent }
  | { type: 'select'; botId: string }
  | { type: 'failed'; message: string };

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'bots-loaded': {
      const preferred = action.bots.find((bot) => bot.pinned) ?? action.bots[0];
      return {
        ...state,
        bots: action.bots,
        ready: true,
        selectedBotId: state.selectedBotId ?? preferred?.id ?? null,
      };
    }
    case 'history-loaded':
      return { ...state, threads: { ...state.threads, [action.botId]: foldEvents(action.events) } };
    case 'event':
      return {
        ...state,
        threads: {
          ...state.threads,
          [action.botId]: applyEvent(state.threads[action.botId] ?? emptyThread, action.event),
        },
      };
    case 'select':
      return { ...state, selectedBotId: action.botId };
    case 'failed':
      return { ...state, ready: true, error: action.message };
  }
}

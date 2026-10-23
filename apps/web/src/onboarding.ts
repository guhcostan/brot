import type { Bot, Device, Routine } from '@brot/protocol';
import type { Provider, Room } from './data/client';
import type { ThreadState } from './state/thread';

/** Where a permanent dismissal of the Getting started panel is remembered. */
export const GETTING_STARTED_DISMISSED_KEY = 'brot.gettingStarted.dismissed';

/** Reads the dismissal flag; false when storage is unavailable or unreadable (SSR, privacy mode). */
export function readGettingStartedDismissed(): boolean {
  try {
    if (typeof globalThis.localStorage === 'undefined') return false;
    return globalThis.localStorage.getItem(GETTING_STARTED_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

/** Persists the dismissal flag; returns false when storage is unavailable (the caller keeps it for the session). */
export function writeGettingStartedDismissed(dismissed = true): boolean {
  try {
    if (typeof globalThis.localStorage === 'undefined') return false;
    if (dismissed) globalThis.localStorage.setItem(GETTING_STARTED_DISMISSED_KEY, '1');
    else globalThis.localStorage.removeItem(GETTING_STARTED_DISMISSED_KEY);
    return true;
  } catch {
    return false;
  }
}

/** A workspace looks fresh until it has a room or a bot thread list with anything in it. */
export function workspaceLooksFresh(input: { rooms: readonly Room[]; threadLists: Readonly<Record<string, readonly unknown[]>> }): boolean {
  if (input.rooms.length > 0) return false;
  return Object.values(input.threadLists).every((threads) => threads.length === 0);
}

/** Whether the panel should open by itself: fresh, not permanently dismissed, not reminded later. */
export function shouldAutoOpenGettingStarted(input: { fresh: boolean; dismissed: boolean; remindLater: boolean }): boolean {
  return input.fresh && !input.dismissed && !input.remindLater;
}

export type GettingStartedItemId = 'modelKey' | 'hello' | 'tools' | 'routine' | 'phone';

export interface GettingStartedItem {
  id: GettingStartedItemId;
  done: boolean;
  optional: boolean;
  /** The fetch behind this item is still loading (or failed), so `done` is not known yet. */
  loading: boolean;
  /** The fetch behind this item failed; Retry re-runs the cheap fetches. */
  failed: boolean;
}

export interface GettingStartedFacts {
  providers: readonly Provider[] | null;
  routines: readonly Routine[] | null;
  devices: readonly Device[] | null;
  bots: readonly Bot[];
  rooms: readonly Room[];
  threads: Readonly<Record<string, ThreadState>>;
}

/** The five checklist rows and their done state, derived only from what the app already loaded. */
export function gettingStartedItems(facts: GettingStartedFacts): GettingStartedItem[] {
  const hasMessage = Object.values(facts.threads).some((thread) => thread.items.some((item) => item.kind === 'message'));
  const providerFailed = facts.providers === null;
  return [
    {
      id: 'modelKey',
      done: facts.providers !== null && facts.providers.some((provider) => provider.configured),
      optional: false,
      loading: providerFailed,
      failed: providerFailed,
    },
    {
      id: 'hello',
      done: hasMessage,
      optional: false,
      loading: false,
      failed: false,
    },
    {
      id: 'tools',
      done: facts.bots.some((bot) => bot.browser === true || bot.desktop === true || bot.computer !== 'none'),
      optional: true,
      loading: false,
      failed: false,
    },
    {
      id: 'routine',
      done: facts.routines !== null && facts.routines.length > 0,
      optional: false,
      loading: facts.routines === null,
      failed: facts.routines === null,
    },
    {
      id: 'phone',
      done: facts.devices !== null && facts.devices.length > 0,
      optional: true,
      loading: facts.devices === null,
      failed: facts.devices === null,
    },
  ];
}

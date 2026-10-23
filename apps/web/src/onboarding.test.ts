import type { Device, Routine, Thread } from '@brot/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEMO_BOTS, DEMO_ROOMS, DEMO_ROUTINES } from './data/fixtures';
import type { Provider } from './data/client';
import { emptyThread } from './state/thread';
import {
  GETTING_STARTED_DISMISSED_KEY,
  gettingStartedItems,
  readGettingStartedDismissed,
  shouldAutoOpenGettingStarted,
  workspaceLoadKnown,
  workspaceLooksFresh,
  writeGettingStartedDismissed,
} from './onboarding';

const at = '2026-10-19T09:00:00.000Z';

const thread = (id: string): Thread => ({ id, botId: 'bot_capy', title: 'Thread', createdAt: at, updatedAt: at });

const provider = (configured: boolean): Provider => ({ id: 'p1', label: 'Provider', models: [], configured, secretName: 'provider_key' });
const device: Device = { id: 'dev_1', name: 'Phone', role: 'full', publicKey: 'key', createdAt: at };
describe('local dismissal', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is off and unwritable when localStorage is unavailable', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(readGettingStartedDismissed()).toBe(false);
    expect(writeGettingStartedDismissed()).toBe(false);
  });

  it('round-trips the dismissal flag through localStorage', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    });

    expect(readGettingStartedDismissed()).toBe(false);
    expect(writeGettingStartedDismissed()).toBe(true);
    expect(store.get(GETTING_STARTED_DISMISSED_KEY)).toBe('1');
    expect(readGettingStartedDismissed()).toBe(true);
    expect(writeGettingStartedDismissed(false)).toBe(true);
    expect(readGettingStartedDismissed()).toBe(false);
  });

  it('survives a throwing storage implementation', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    });

    expect(readGettingStartedDismissed()).toBe(false);
    expect(writeGettingStartedDismissed()).toBe(false);
  });
});

describe('workspaceLooksFresh', () => {
  const bareBot = { ...DEMO_BOTS[0]!, archived: false };

  it('is fresh only when bots, rooms and every non-archived thread list are loaded and empty', () => {
    expect(workspaceLooksFresh({ bots: [bareBot], rooms: [], threadLists: { [bareBot.id]: [] } })).toBe(true);
    expect(workspaceLooksFresh({ bots: [], rooms: [], threadLists: {} })).toBe(true);
  });

  it('is not fresh while any piece is unknown', () => {
    expect(workspaceLooksFresh({ bots: null, rooms: [], threadLists: {} })).toBe(false);
    expect(workspaceLooksFresh({ bots: [bareBot], rooms: null, threadLists: {} })).toBe(false);
    expect(workspaceLooksFresh({ bots: [bareBot], rooms: [], threadLists: {} })).toBe(false);
    expect(workspaceLooksFresh({ bots: [bareBot], rooms: null, threadLists: { [bareBot.id]: [] } })).toBe(false);
  });

  it('is not fresh once a loaded thread list has a conversation', () => {
    expect(workspaceLooksFresh({ bots: [bareBot], rooms: [], threadLists: { [bareBot.id]: [thread('t1')] } })).toBe(false);
  });

  it('is not fresh once rooms are loaded and non-empty', () => {
    expect(workspaceLooksFresh({ bots: [bareBot], rooms: DEMO_ROOMS, threadLists: { [bareBot.id]: [] } })).toBe(false);
  });

  it('ignores archived bots and requires only non-archived lists', () => {
    const archived = { ...bareBot, id: 'bot_archived', archived: true };
    expect(workspaceLooksFresh({ bots: [bareBot, archived], rooms: [], threadLists: { [bareBot.id]: [] } })).toBe(true);
  });
});

describe('workspaceLoadKnown', () => {
  it('requires the bot and room lists plus every non-archived thread list', () => {
    const bareBot = { ...DEMO_BOTS[0]!, archived: false };
    expect(workspaceLoadKnown({ bots: [bareBot], rooms: [], threadLists: { [bareBot.id]: [] } })).toBe(true);
    expect(workspaceLoadKnown({ bots: [bareBot], rooms: [], threadLists: {} })).toBe(false);
    expect(workspaceLoadKnown({ bots: null, rooms: [], threadLists: {} })).toBe(false);
    expect(workspaceLoadKnown({ bots: [bareBot], rooms: null, threadLists: { [bareBot.id]: [] } })).toBe(false);
  });
});

describe('shouldAutoOpenGettingStarted', () => {
  it('opens only for a fresh, not dismissed, not postponed workspace', () => {
    expect(shouldAutoOpenGettingStarted({ fresh: true, dismissed: false, remindLater: false })).toBe(true);
    expect(shouldAutoOpenGettingStarted({ fresh: true, dismissed: true, remindLater: false })).toBe(false);
    expect(shouldAutoOpenGettingStarted({ fresh: true, dismissed: false, remindLater: true })).toBe(false);
    expect(shouldAutoOpenGettingStarted({ fresh: false, dismissed: false, remindLater: false })).toBe(false);
  });
});

describe('gettingStartedItems', () => {
  const bareBot = { ...DEMO_BOTS[0]!, computer: 'none' as const, browser: false, desktop: false };
  const facts = {
    providers: [provider(false)],
    routines: [] as Routine[],
    devices: [] as Device[],
    bots: [bareBot],
    rooms: [] as typeof DEMO_ROOMS,
    threads: {},
  };

  it('marks a fresh workspace with pending states', () => {
    const items = gettingStartedItems(facts);

    expect(items.map((item) => item.id)).toEqual(['modelKey', 'hello', 'tools', 'routine', 'phone']);
    expect(items.every((item) => !item.done)).toBe(true);
    expect(items.find((item) => item.id === 'tools')?.optional).toBe(true);
    expect(items.find((item) => item.id === 'phone')?.optional).toBe(true);
  });

  it('marks configured keys, messages, tools, routines and a phone as done', () => {
    const items = gettingStartedItems({
      ...facts,
      providers: [provider(true)],
      routines: DEMO_ROUTINES,
      devices: [device],
      bots: DEMO_BOTS,
      threads: { thr_1: { ...emptyThread, items: [{ kind: 'message', id: 'm1', role: 'user', content: 'hi', streaming: false, at }] } },
    });

    for (const item of items) expect(item.done).toBe(true);
  });

  it('leaves a model key pending for an unconfigured provider and marks a failed fetch', () => {
    const failing = gettingStartedItems({ ...facts, providers: null, routines: null, devices: null });

    expect(failing.find((item) => item.id === 'modelKey')).toMatchObject({ done: false, loading: true, failed: true });
    expect(failing.find((item) => item.id === 'routine')).toMatchObject({ done: false, loading: true, failed: true });
    expect(failing.find((item) => item.id === 'phone')).toMatchObject({ done: false, loading: true, failed: true });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockClient } from './mockClient';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('mock thread model overrides', () => {
  it('sets and clears a DM thread model, keeping the bot default otherwise', async () => {
    const client = createMockClient();
    const threads = await client.listThreads('bot_capy');
    const first = threads[0];
    if (!first) throw new Error('Capy has no DM thread');

    expect(first.model).toBeUndefined();

    const overridden = await client.updateThread(first.id, { model: 'opencode-go/deepseek-v4.1-flash' });
    expect(overridden.model).toBe('opencode-go/deepseek-v4.1-flash');

    const renamed = await client.updateThread(first.id, { title: 'Renamed by test', model: null });
    expect(renamed.title).toBe('Renamed by test');
    expect(renamed.model).toBeUndefined();

    const listed = (await client.listThreads('bot_capy')).find((thread) => thread.id === first.id);
    expect(listed?.model).toBeUndefined();
    expect(listed?.title).toBe('Renamed by test');
  });

  it('refuses a thread-wide model on a room', async () => {
    const client = createMockClient();
    const rooms = await client.listRooms();
    const room = rooms[0];
    if (!room) throw new Error('no room seeded');

    await expect(client.updateThread(room.thread.id, { model: 'opencode-go/deepseek-v4.1-flash' })).rejects.toThrow();
    // The room title can still change.
    const renamed = await client.updateThread(room.thread.id, { title: 'Renamed room' });
    expect(renamed.title).toBe('Renamed room');
  });

  it('rejects an unknown thread and an empty patch', async () => {
    const client = createMockClient();
    await expect(client.updateThread('missing', { title: 'x' })).rejects.toThrow();
    const first = (await client.listThreads('bot_capy'))[0];
    if (!first) throw new Error('Capy has no DM thread');
    await expect(client.updateThread(first.id, {})).rejects.toThrow();
  });
});

describe('mock room deletion', () => {
  it('removes the room, its thread state and its messages', async () => {
    const client = createMockClient();
    const room = (await client.listRooms())[0];
    if (!room) throw new Error('no room seeded');
    expect((await client.roomHistory(room.thread.id)).length).toBeGreaterThan(0);

    await client.deleteRoom(room.thread.id);

    expect((await client.listRooms()).some((entry) => entry.thread.id === room.thread.id)).toBe(false);
    await expect(client.roomHistory(room.thread.id)).resolves.toEqual([]);
    await expect(client.deleteRoom(room.thread.id)).rejects.toThrow();
  });
});

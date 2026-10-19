import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CanonicalEvent, Task } from '@brot/protocol';
import { foldEvents, gazeTargets, pendingApprovals } from '../state/thread';
import type { BotEvent } from './client';
import { LAUNCH_ROOM, WEEK_ROOM } from './fixtures';
import { createMockClient } from './mockClient';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('mock team scenario', () => {
  it('seeds only protocol-valid events and tasks', async () => {
    const client = createMockClient();
    for (const bot of await client.listBots()) {
      for (const event of await client.history(bot.id)) expect(() => CanonicalEvent.parse(event)).not.toThrow();
    }
    for (const room of await client.listRooms()) {
      for (const event of await client.roomHistory(room.thread.id)) expect(() => CanonicalEvent.parse(event)).not.toThrow();
    }
    for (const task of await client.listTasks()) expect(() => Task.parse(task)).not.toThrow();
  });

  it('opens on a live exchange and a task blocked on an approval', async () => {
    const client = createMockClient();
    const room = foldEvents(await client.roomHistory(LAUNCH_ROOM));
    expect(gazeTargets(room)).toEqual({ bot_onca: 'bot_tamu' });
    expect(room.items.some((item) => item.kind === 'handoff')).toBe(true);

    const tuca = foldEvents(await client.history('bot_tuca'));
    expect(pendingApprovals(tuca)).toHaveLength(1);
    expect((await client.listTasks({ status: 'blocked' })).map((task) => task.assigneeBotId)).toEqual(['bot_tuca']);
  });

  it('finishes the blocked task when the send is approved', async () => {
    const client = createMockClient();
    const events: BotEvent[] = [];
    client.onEvent((event) => events.push(event));
    const resolving = client.resolveApproval('appr_seed_1', { decision: 'allow_once' });
    await vi.runAllTimersAsync();
    await resolving;
    const updated = events.flatMap(({ event }) => (event.type === 'task.updated' ? [event.task] : []));
    expect(updated.at(-1)).toMatchObject({ id: 'task_email', status: 'done' });
  });

  it('answers only mentioned bots in a mention room, and the lead otherwise', async () => {
    const client = createMockClient();
    const started: string[] = [];
    client.onEvent(({ event }) => {
      if (event.type === 'run.started') started.push(event.botId);
    });

    await client.postRoomMessage(WEEK_ROOM, { content: 'anyone there?' });
    await vi.runAllTimersAsync();
    expect(started).toEqual([]);

    await client.postRoomMessage(WEEK_ROOM, { content: '@Boto and @Sol, take a look' });
    await vi.runAllTimersAsync();
    expect(started).toEqual(['bot_boto', 'bot_sol']);
  });

  it('creates, starts and cancels a task', async () => {
    const client = createMockClient();
    const events: BotEvent[] = [];
    client.onEvent((event) => events.push(event));
    const created = await client.createTask({ title: 'Check the docs', assigneeBotId: 'bot_tamu' });
    expect(created).toMatchObject({ status: 'open', depth: 0, createdByUser: true, chainId: created.id });
    await vi.advanceTimersByTimeAsync(1000);
    expect((await client.listTasks({ status: 'in_progress' })).some((task) => task.id === created.id)).toBe(true);
    await expect(client.cancelTask(created.id)).resolves.toMatchObject({ status: 'cancelled' });
    await vi.runAllTimersAsync();
    expect((await client.listTasks()).find((task) => task.id === created.id)?.status).toBe('cancelled');
    expect(events[0]).toMatchObject({ botId: 'bot_tamu', event: { type: 'task.created' } });
  });

  it('refuses a room with one bot', async () => {
    const client = createMockClient();
    await expect(client.createRoom({ title: 'Solo', botIds: ['bot_capy'], leadBotId: 'bot_capy', responder: 'lead' })).rejects.toThrow();
  });
});

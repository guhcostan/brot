import type { Bot, Thread } from '@brot/protocol';
import { createEngineRegistry } from '@brot/engines';
import { afterEach, describe, expect, it } from 'vitest';
import { call, createTestContext, type TestContext } from '../testing';
import { json, recordingEngine, until, type Recording } from './fixtures';

const contexts: TestContext[] = [];

afterEach(async () => {
  await Promise.all(contexts.splice(0).map((ctx) => ctx.close()));
});

interface DeciderCall {
  url: string;
  body: { model: string; messages: Array<{ role: string; content: string }> };
}

interface AutoRoom {
  ctx: TestContext;
  recording: Recording;
  capy: Bot;
  dex: Bot;
  room: Thread;
  calls: DeciderCall[];
}

/** A test context whose decider model answers through `answer`, recording each decider request. */
async function openAutoRoom(
  answer: (message: string) => Response | Promise<Response>,
): Promise<AutoRoom> {
  const recording = recordingEngine();
  const calls: DeciderCall[] = [];
  const ctx = await createTestContext({
    engines: createEngineRegistry([recording.driver]),
    decider: {
      fetch: async (url, init) => {
        const body = JSON.parse(String(init.body)) as DeciderCall['body'];
        calls.push({ url, body });
        return answer(body.messages[1]?.content ?? '');
      },
    },
  });
  contexts.push(ctx);
  await ctx.services.vault.set('deepseek', 'sk-decider-test');
  const capy = await ctx.services.repos.bots.create({ name: 'Capy', job: 'Lead', engine: 'mock', computer: 'none' });
  const dex = await ctx.services.repos.bots.create({ name: 'Dex', job: 'Developer', engine: 'mock', computer: 'none' });
  const configured = await call(ctx.app, 'PUT', '/api/room-decider', { model: 'deepseek/deepseek-flash' });
  expect(configured.status).toBe(200);
  const room = await json<Thread>(
    await call(ctx.app, 'POST', '/api/rooms', {
      title: 'Team',
      botIds: [capy.id, dex.id],
      leadBotId: capy.id,
      responder: 'auto',
    }),
  );
  return { ctx, recording, capy, dex, room, calls };
}

async function post(ctx: TestContext, roomId: string, content: string): Promise<{ runId: string | null }> {
  const response = await call(ctx.app, 'POST', `/api/threads/${roomId}/messages`, { content });
  expect(response.status).toBe(202);
  return json<{ runId: string | null }>(response);
}

/** Waits until the reply runs the room started have all ended. */
async function untilIdle(ctx: TestContext, roomId: string): Promise<void> {
  await until(async () => {
    const runs = await ctx.services.repos.runs.listByThread(roomId);
    return runs.length > 0 && runs.every((run) => run.status !== 'running' && run.status !== 'waiting_approval');
  });
}

describe('auto responder routing', () => {
  it('runs the member the decider picks when nobody is mentioned', async () => {
    const { ctx, recording, dex, room, calls } = await openAutoRoom(() =>
      Response.json({ choices: [{ message: { content: 'Dex' } }] }),
    );

    const { runId } = await post(ctx, room.id, 'Who should handle the pricing page?');
    expect(runId).not.toBeNull();
    await untilIdle(ctx, room.id);

    expect(recording.runs).toHaveLength(1);
    expect(recording.runs[0]?.bot.id).toBe(dex.id);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(calls[0]?.body.model).toBe('deepseek-flash');
    expect(calls[0]?.body.messages[0]?.content).toContain(`${dex.id} — Dex — Developer`);
    expect(calls[0]?.body.messages[1]?.content).toBe('Who should handle the pricing page?');
  });

  it('falls back to the lead when the decider names no member', async () => {
    const { ctx, recording, capy, room } = await openAutoRoom(() =>
      Response.json({ choices: [{ message: { content: 'Ghost' } }] }),
    );

    await post(ctx, room.id, 'Anybody?');
    await untilIdle(ctx, room.id);

    expect(recording.runs).toHaveLength(1);
    expect(recording.runs[0]?.bot.id).toBe(capy.id);
  });

  it('falls back to the lead when the decider request fails or throws', async () => {
    const failed = await openAutoRoom(() => new Response('down', { status: 500 }));
    await post(failed.ctx, failed.room.id, 'Anybody?');
    await untilIdle(failed.ctx, failed.room.id);
    expect(failed.recording.runs[0]?.bot.id).toBe(failed.capy.id);

    const broken = await openAutoRoom(() => {
      throw new Error('connection refused');
    });
    await post(broken.ctx, broken.room.id, 'Anybody?');
    await untilIdle(broken.ctx, broken.room.id);
    expect(broken.recording.runs[0]?.bot.id).toBe(broken.capy.id);
  });

  it('falls back to the baton holder when the decider cannot pick', async () => {
    const { ctx, recording, dex, room } = await openAutoRoom(() => new Response('down', { status: 500 }));
    await ctx.services.rooms.setBaton(room.id, dex.id);

    await post(ctx, room.id, 'Anybody?');
    await untilIdle(ctx, room.id);

    expect(recording.runs).toHaveLength(1);
    expect(recording.runs[0]?.bot.id).toBe(dex.id);
  });

  it('lets an explicit mention win in an auto room, without asking the decider', async () => {
    const { ctx, recording, dex, room, calls } = await openAutoRoom(() =>
      Response.json({ choices: [{ message: { content: 'Capy' } }] }),
    );

    await post(ctx, room.id, '@Dex please take this one');
    await untilIdle(ctx, room.id);

    expect(recording.runs).toHaveLength(1);
    expect(recording.runs[0]?.bot.id).toBe(dex.id);
    expect(calls).toEqual([]);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_BOTS, DEMO_ROUTINES } from './fixtures';
import { createMockClient } from './mockClient';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const botId = DEMO_BOTS[0]!.id;

describe('mock webhooks', () => {
  it('reports a fixed receiver port', async () => {
    const client = createMockClient();
    await expect(client.getWebhookInfo()).resolves.toEqual({ port: 8992 });
  });

  it('rotates a webhook routine secret and keeps it', async () => {
    const client = createMockClient();
    const created = await client.createRoutine({
      botId,
      name: 'Deploy hook',
      instruction: 'Deploy the thing.',
      trigger: { type: 'webhook', secret: 'wh_old_secret' },
    });

    const rotated = await client.rotateRoutineWebhook(created.id);
    expect(rotated.trigger).toMatchObject({ type: 'webhook' });
    if (rotated.trigger.type !== 'webhook') throw new Error('expected a webhook routine');
    expect(rotated.trigger.secret).not.toBe('wh_old_secret');
    expect(rotated.trigger.secret.length).toBeGreaterThan(0);

    const stored = (await client.listRoutines()).find((routine) => routine.id === created.id);
    expect(stored?.trigger).toEqual(rotated.trigger);
  });

  it('refuses cron routines with a conflict and unknown ids with a 404-like error', async () => {
    const client = createMockClient();
    const cron = DEMO_ROUTINES[0]!;
    await expect(client.rotateRoutineWebhook(cron.id)).rejects.toThrow('409');
    await expect(client.rotateRoutineWebhook('nope')).rejects.toThrow('404');
  });
});

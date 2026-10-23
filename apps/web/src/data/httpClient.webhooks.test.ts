import type { Routine } from '@brot/protocol';
import { describe, expect, it } from 'vitest';
import { createHttpClient, type FetchLike } from './httpClient';

const at = '2026-10-19T09:00:00.000Z';
const routine: Routine = {
  id: 'routine_1',
  botId: 'bot_1',
  name: 'Deploy hook',
  instruction: 'Deploy the thing.',
  trigger: { type: 'webhook', secret: 'wh_new_secret' },
  enabled: true,
  catchUp: true,
  rememberLastRun: false,
  createdAt: at,
  updatedAt: at,
};

interface Call {
  method: string;
  path: string;
  body: unknown;
}

function fakeFetch(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (input, init = {}) => {
    const path = new URL(input, 'http://brot.test').pathname;
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method ?? 'GET', path, body });
    return respond({ method: init.method ?? 'GET', path, body });
  };
  return { fetch, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('webhook routes', () => {
  it('reads the receiver port and tolerates a missing one', async () => {
    const { fetch, calls } = fakeFetch(() => json({ port: 8992 }));
    const client = createHttpClient({ fetch });

    await expect(client.getWebhookInfo()).resolves.toEqual({ port: 8992 });
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/api/webhooks' });

    const missing = createHttpClient({ fetch: fakeFetch(() => json({})).fetch });
    await expect(missing.getWebhookInfo()).resolves.toEqual({});
  });

  it('rotates a webhook secret and reads the refreshed routine', async () => {
    const { fetch, calls } = fakeFetch(() => json(routine));
    const client = createHttpClient({ fetch });

    await expect(client.rotateRoutineWebhook('routine/1')).resolves.toEqual(routine);
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/routines/routine%2F1/webhook/rotate', body: {} });
  });

  it('surfaces 409 for a cron routine and 404 for an unknown one', async () => {
    const cron = createHttpClient({ fetch: fakeFetch(() => json({ error: 'This routine is not a webhook routine' }, 409)).fetch });
    await expect(cron.rotateRoutineWebhook('r_cron')).rejects.toThrow('409 This routine is not a webhook routine');

    const unknown = createHttpClient({ fetch: fakeFetch(() => json({ error: 'Routine not found' }, 404)).fetch });
    await expect(unknown.rotateRoutineWebhook('nope')).rejects.toThrow('404 Routine not found');
  });

  it('rejects a malformed rotated routine', async () => {
    const client = createHttpClient({ fetch: fakeFetch(() => json({ id: 'r1' })).fetch });
    await expect(client.rotateRoutineWebhook('r1')).rejects.toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import { ApiError, BrotClient, ServerUnreachableError } from './client';
import { fakeFetch, json, unreachable } from './testing';

const at = '2026-10-19T12:00:00.000Z';
const bot = {
  id: 'bot_1',
  name: 'Capy',
  job: 'Chief of Staff',
  instructions: '',
  engine: 'mock',
  computer: 'none',
  pinned: false,
  archived: false,
  createdAt: at,
  updatedAt: at,
};

describe('BrotClient', () => {
  it('normalizes the base URL and validates health', async () => {
    const { fetch, requests } = fakeFetch({
      'GET /api/health': () => json({ ok: true, version: '0.1.0', protocol: 1 }),
    });
    const client = new BrotClient('http://127.0.0.1:8799/', fetch);

    expect(client.baseUrl).toBe('http://127.0.0.1:8799');
    expect(await client.health()).toEqual({ ok: true, version: '0.1.0', protocol: 1 });
    expect(requests).toEqual([{ method: 'GET', path: '/api/health', body: undefined }]);
  });

  it('rejects a health response that does not match the contract', async () => {
    const { fetch } = fakeFetch({ 'GET /api/health': () => json({ ok: false }) });
    const client = new BrotClient('http://127.0.0.1:8799', fetch);

    const error = await client.health().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as Error).message).toMatch(/^\/api\/health returned an unexpected shape/);
  });

  it('returns undefined for a missing bot and throws on other failures', async () => {
    const { fetch } = fakeFetch({
      'GET /api/bots/missing': () => json({ error: 'Bot not found' }, 404),
      'GET /api/bots/bot_1': () => json({ error: 'Internal server error' }, 500),
    });
    const client = new BrotClient('http://127.0.0.1:8799', fetch);

    expect(await client.getBot('missing')).toBeUndefined();
    await expect(client.getBot('bot_1')).rejects.toThrow('/api/bots/bot_1 failed (HTTP 500): Internal server error');
  });

  it('returns a bot that matches the contract', async () => {
    const { fetch } = fakeFetch({ 'GET /api/bots/bot_1': () => json(bot) });
    const client = new BrotClient('http://127.0.0.1:8799', fetch);

    expect(await client.getBot('bot_1')).toEqual(bot);
  });

  it('explains when no server answers', async () => {
    const client = new BrotClient('http://127.0.0.1:8799', unreachable);

    const error = await client.getBot('bot_1').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ServerUnreachableError);
    expect((error as Error).message).toBe(
      'No Brot server answered at http://127.0.0.1:8799. Start one with "brot serve" or pass --url.',
    );
  });

  it('posts a message as JSON and validates the run id', async () => {
    const { fetch, requests } = fakeFetch({
      'POST /api/threads/t1/messages': () => json({ runId: 'run_1' }, 202),
    });
    const client = new BrotClient('http://127.0.0.1:8799', fetch);

    expect(await client.startRun('t1', 'hi')).toEqual({ runId: 'run_1' });
    expect(requests).toEqual([{ method: 'POST', path: '/api/threads/t1/messages', body: { content: 'hi' } }]);
  });

  it('streams only valid canonical events and reports the rest', async () => {
    const valid = { type: 'run.completed', id: 'e1', at, threadId: 't1', runId: 'run_1' };
    const { fetch, requests } = fakeFetch({
      'GET /api/events': () => {
        const body = `data: not json\n\ndata: {"type":"mystery"}\n\ndata: ${JSON.stringify(valid)}\n\n`;
        return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
      },
    });
    const client = new BrotClient('http://127.0.0.1:8799', fetch);
    const invalid: string[] = [];

    const events = [];
    for await (const event of client.events({
      threadId: 't1',
      after: at,
      signal: new AbortController().signal,
      onInvalidEvent: (data) => invalid.push(data),
    })) {
      events.push(event);
    }

    expect(events).toEqual([valid]);
    expect(invalid).toEqual(['not json', '{"type":"mystery"}']);
    expect(requests[0]?.path).toBe(`/api/events?threadId=t1&after=${encodeURIComponent(at)}`);
  });

  it('turns a failed event request into an ApiError', async () => {
    const { fetch } = fakeFetch({
      'GET /api/events': () => json({ error: 'Invalid request', issues: [] }, 400),
    });
    const client = new BrotClient('http://127.0.0.1:8799', fetch);

    const iterate = async () => {
      for await (const event of client.events({ threadId: 't1', signal: new AbortController().signal })) {
        void event;
      }
    };
    await expect(iterate()).rejects.toThrow('/api/events failed (HTTP 400): Invalid request');
  });
});

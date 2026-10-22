import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockClient } from './mockClient';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('mock message search', () => {
  it('finds seeded messages case-insensitively with plain-text snippets', async () => {
    const client = createMockClient();
    const hits = await client.searchMessages({ q: 'ACME' });

    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      expect(hit.snippet.toLowerCase()).toContain('acme');
      expect(hit.snippet).not.toContain('<');
      expect(hit.threadTitle.length).toBeGreaterThan(0);
      expect(hit.botName).toBeTruthy();
    }
  });

  it('returns newest first', async () => {
    const client = createMockClient();
    const hits = await client.searchMessages({ q: 'the', limit: 20 });

    expect(hits.length).toBeGreaterThan(1);
    const timestamps = hits.map((hit) => hit.createdAt);
    expect(timestamps).toEqual([...timestamps].sort().reverse());
  });

  it('honours the limit and the bot filter', async () => {
    const client = createMockClient();
    const limited = await client.searchMessages({ q: 'the', limit: 2 });
    expect(limited).toHaveLength(2);

    const capy = await client.searchMessages({ q: 'the', botId: 'bot_capy' });
    expect(capy.length).toBeGreaterThan(0);
    expect(capy.every((hit) => hit.botId === 'bot_capy')).toBe(true);

    const room = await client.searchMessages({ q: 'export', threadId: 'room_acme' });
    expect(room.length).toBeGreaterThan(0);
    expect(room.every((hit) => hit.threadId === 'room_acme')).toBe(true);
  });

  it('returns nothing for a term that is not there', async () => {
    const client = createMockClient();
    await expect(client.searchMessages({ q: 'zzzz-not-a-word' })).resolves.toEqual([]);
  });
});

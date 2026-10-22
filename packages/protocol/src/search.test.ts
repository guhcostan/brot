import { describe, expect, it } from 'vitest';
import {
  SEARCH_LIMIT_DEFAULT,
  SEARCH_LIMIT_MAX,
  SEARCH_QUERY_MAX_LENGTH,
  SearchHit,
  SearchQuery,
} from './search';

const at = '2026-10-22T12:00:00.000Z';

const roundTrip = <T>(schema: { parse: (input: unknown) => T }, value: unknown): T => {
  const parsed = schema.parse(value);
  return schema.parse(JSON.parse(JSON.stringify(parsed)));
};

describe('SearchQuery', () => {
  it('defaults the limit and accepts the optional filters', () => {
    expect(SearchQuery.parse({ q: 'deploy' })).toEqual({ q: 'deploy', limit: SEARCH_LIMIT_DEFAULT });
    expect(SEARCH_LIMIT_DEFAULT).toBe(20);
    expect(SEARCH_LIMIT_MAX).toBe(50);
    expect(
      SearchQuery.parse({ q: 'deploy', botId: 'bot_1', threadId: 't1', limit: '5', before: at }),
    ).toEqual({ q: 'deploy', botId: 'bot_1', threadId: 't1', limit: 5, before: at });
    expect(SearchQuery.parse({ q: 'deploy', limit: 50 }).limit).toBe(SEARCH_LIMIT_MAX);
  });

  it('rejects a blank, missing or oversized q', () => {
    expect(() => SearchQuery.parse({})).toThrow();
    expect(() => SearchQuery.parse({ q: '' })).toThrow();
    expect(() => SearchQuery.parse({ q: '   ' })).toThrow(/blank/);
    expect(() => SearchQuery.parse({ q: 'x'.repeat(SEARCH_QUERY_MAX_LENGTH) })).not.toThrow();
    expect(() => SearchQuery.parse({ q: 'x'.repeat(SEARCH_QUERY_MAX_LENGTH + 1) })).toThrow();
  });

  it('rejects a limit outside 1..50 and an invalid before', () => {
    expect(() => SearchQuery.parse({ q: 'x', limit: '0' })).toThrow();
    expect(() => SearchQuery.parse({ q: 'x', limit: '51' })).toThrow();
    expect(() => SearchQuery.parse({ q: 'x', limit: 'abc' })).toThrow();
    expect(() => SearchQuery.parse({ q: 'x', limit: '1.5' })).toThrow();
    expect(() => SearchQuery.parse({ q: 'x', before: 'yesterday' })).toThrow();
    expect(() => SearchQuery.parse({ q: 'x', before: '2026-10-22' })).toThrow();
  });
});

describe('SearchHit', () => {
  it('round-trips a hit with and without bot fields', () => {
    const hit = {
      messageId: 'm1',
      threadId: 't1',
      threadTitle: 'Planning',
      botId: 'bot_1',
      botName: 'Ada',
      role: 'assistant',
      snippet: '…ship the release…',
      createdAt: at,
    };
    expect(roundTrip(SearchHit, hit)).toEqual(hit);
    const bare = {
      messageId: 'm2',
      threadId: 't2',
      threadTitle: 'Chat',
      role: 'user',
      snippet: 'hello',
      createdAt: at,
    };
    expect(roundTrip(SearchHit, bare)).toEqual(bare);
  });

  it('rejects an unknown role and a bad timestamp', () => {
    const hit = {
      messageId: 'm1',
      threadId: 't1',
      threadTitle: 'Chat',
      role: 'assistant',
      snippet: 'x',
      createdAt: at,
    };
    expect(() => SearchHit.parse({ ...hit, role: 'tool' })).toThrow();
    expect(() => SearchHit.parse({ ...hit, createdAt: 'yesterday' })).toThrow();
    expect(() => SearchHit.parse({ ...hit, botName: '' })).toThrow();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockClient } from './mockClient';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('mock bot browser mode', () => {
  it('round-trips my-chrome and back to own', async () => {
    const client = createMockClient();
    const created = await client.createBot({ name: 'Scout', job: 'Look around', browser: true, browserMode: 'my-chrome', computer: 'none' });
    expect(created.browserMode).toBe('my-chrome');
    expect(created.browser).toBe(true);

    const back = await client.updateBot(created.id, { browserMode: 'own' });
    expect(back.browserMode).toBe('own');
  });

  it('omits the mode for an own browser bot and refuses my-chrome without a browser', async () => {
    const client = createMockClient();
    const own = await client.createBot({ name: 'Scout', job: 'Look around', browser: true, computer: 'none' });
    expect(own.browserMode).toBeUndefined();

    await expect(client.createBot({ name: 'Scout', job: 'Look around', browser: false, browserMode: 'my-chrome', computer: 'none' })).rejects.toThrow();
  });
});

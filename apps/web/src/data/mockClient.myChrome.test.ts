import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MY_CHROME_DEFAULT_ENDPOINT } from './client';
import { createMockClient } from './mockClient';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('mock my chrome', () => {
  it('defaults to Brot’s own 9333 endpoint, never the shared 9222', () => {
    expect(MY_CHROME_DEFAULT_ENDPOINT).toBe('http://127.0.0.1:9333');
  });

  it('starts on the default endpoint and reachable', async () => {
    const client = createMockClient();
    await expect(client.getMyChrome()).resolves.toEqual({
      settings: { endpoint: MY_CHROME_DEFAULT_ENDPOINT },
      available: true,
    });
  });

  it('round-trips another loopback endpoint and reports it unreachable', async () => {
    const client = createMockClient();
    const saved = await client.updateMyChrome({ endpoint: 'http://127.0.0.1:9444' });

    expect(saved.settings.endpoint).toBe('http://127.0.0.1:9444');
    expect(saved.settings.updatedAt).toBeTruthy();
    expect(saved.available).toBe(false);
    expect(saved.reason).toBeTruthy();
    await expect(client.getMyChrome()).resolves.toMatchObject({ settings: { endpoint: 'http://127.0.0.1:9444' }, available: false });
  });

  it('returns to reachable on the default endpoint and rejects bad addresses', async () => {
    const client = createMockClient();
    await client.updateMyChrome({ endpoint: 'http://127.0.0.1:9444' });
    await expect(client.updateMyChrome({ endpoint: MY_CHROME_DEFAULT_ENDPOINT })).resolves.toMatchObject({ available: true });

    await expect(client.updateMyChrome({ endpoint: 'http://192.168.1.20:9333' })).rejects.toThrow();
    await expect(client.updateMyChrome({ endpoint: 'not a url' })).rejects.toThrow();
  });
});

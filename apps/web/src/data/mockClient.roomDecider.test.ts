import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockClient } from './mockClient';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('mock room decider', () => {
  it('starts unset', async () => {
    const client = createMockClient();
    await expect(client.getRoomDeciderSettings()).resolves.toEqual({});
  });

  it('round-trips a supported model and clears it', async () => {
    const client = createMockClient();
    const saved = await client.updateRoomDeciderSettings({ model: 'opencode-go/deepseek-v4.1-flash' });
    expect(saved.model).toBe('opencode-go/deepseek-v4.1-flash');
    expect(saved.updatedAt).toBeTruthy();
    await expect(client.getRoomDeciderSettings()).resolves.toMatchObject({ model: 'opencode-go/deepseek-v4.1-flash' });

    await expect(client.updateRoomDeciderSettings({ model: null })).resolves.toEqual({ updatedAt: saved.updatedAt });
    await expect(client.getRoomDeciderSettings()).resolves.toEqual({ updatedAt: saved.updatedAt });
  });

  it('refuses unsupported providers, unknown models and blank values', async () => {
    const client = createMockClient();
    await expect(client.updateRoomDeciderSettings({ model: 'anthropic/claude-sonnet' })).rejects.toThrow('cannot be the room decider');
    await expect(client.updateRoomDeciderSettings({ model: 'nope/nope' })).rejects.toThrow('Unknown decider model');
    await expect(client.updateRoomDeciderSettings({ model: '  ' })).rejects.toThrow();
    await expect(client.getRoomDeciderSettings()).resolves.toEqual({});
  });
});

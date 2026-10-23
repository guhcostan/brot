import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockClient } from './mockClient';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('mock admin activity', () => {
  it('seeds representative entries newest first', async () => {
    const client = createMockClient();
    const entries = await client.listAdminActivity();

    expect(entries.length).toBeGreaterThanOrEqual(4);
    expect(new Set(entries.map((entry) => entry.action))).toEqual(new Set(['updated', 'created', 'revoked', 'deleted', 'ran']));
    const times = entries.map((entry) => Date.parse(entry.at));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(entries.some((entry) => entry.actor === 'Pixel 9')).toBe(true);
  });

  it('records bot mutations with human summaries', async () => {
    const client = createMockClient();
    const created = await client.createBot({ name: 'Scout', job: 'Look around', computer: 'none' });
    await client.updateBot(created.id, { job: 'Watch the room' });
    await client.deleteBot(created.id);

    const entries = await client.listAdminActivity({ limit: 3 });
    expect(entries.map((entry) => entry.summary)).toEqual([
      'Deleted bot Scout',
      'Updated bot Scout',
      'Created bot Scout',
    ]);
    expect(entries.every((entry) => entry.targetType === 'bot' && entry.actor === 'local')).toBe(true);
  });

  it('records settings PUTs and saved-login changes', async () => {
    const client = createMockClient();
    await client.updateTranscriptionSettings({ model: 'opencode-go/deepseek-v4.1-flash' });
    const login = await client.createSavedLogin({ name: 'Acme', host: 'acme.example', username: 'ana', password: 'pw' });
    await client.deleteSavedLogin(login.id);

    const summaries = (await client.listAdminActivity({ limit: 3 })).map((entry) => entry.summary);
    expect(summaries).toEqual(['Deleted saved login for Acme', 'Added saved login for Acme', 'Updated transcription settings']);
  });

  it('records a revoked device and honours the limit', async () => {
    const client = createMockClient();
    const [device] = await client.listDevices();
    expect(device).toBeDefined();
    await client.removeDevice(device!.id);

    const [latest] = await client.listAdminActivity({ limit: 1 });
    expect(latest).toMatchObject({ action: 'revoked', targetType: 'device', summary: `Revoked phone ${device!.name}` });

    await expect(client.listAdminActivity({ limit: 0 })).rejects.toThrow();
  });
});

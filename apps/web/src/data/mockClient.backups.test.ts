import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockClient } from './mockClient';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('mock backups', () => {
  it('starts disabled with 24h/keep 5 and two seeded backups', async () => {
    const client = createMockClient();
    const status = await client.getBackups();

    expect(status.settings).toMatchObject({ enabled: false, intervalHours: 24, keep: 5 });
    expect(status.backups).toHaveLength(2);
    expect(status.backups[0]!.includesSecrets).toBe(true);
    expect(status.nextRunAt).toBeUndefined();
    const times = status.backups.map((backup) => Date.parse(backup.createdAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('saves settings and reports the next run once enabled', async () => {
    const client = createMockClient();
    const saved = await client.updateBackupSettings({ enabled: true, intervalHours: 12, keep: 3 });

    expect(saved).toMatchObject({ enabled: true, intervalHours: 12, keep: 3 });
    const status = await client.getBackups();
    expect(status.settings).toMatchObject({ enabled: true, intervalHours: 12, keep: 3 });
    expect(status.nextRunAt).toBeTruthy();
  });

  it('runs a backup now, prepends it and trims to keep', async () => {
    const client = createMockClient();
    await client.updateBackupSettings({ keep: 1 });
    const before = await client.getBackups();

    const entry = await client.runBackupNow();
    expect(entry).toMatchObject({ includesSecrets: true, sizeBytes: expect.any(Number) });
    expect(entry.sizeBytes).toBeGreaterThan(0);

    const status = await client.getBackups();
    expect(status.backups[0]?.name).toBe(entry.name);
    expect(status.backups).toHaveLength(1);
    expect(status.settings.lastBackupName).toBe(entry.name);
    expect(Date.parse(entry.createdAt)).toBeGreaterThanOrEqual(Date.parse(before.backups[0]!.createdAt));
  });

  it('rejects invalid patches and unknown input', async () => {
    const client = createMockClient();
    await expect(client.updateBackupSettings({})).rejects.toThrow();
    await expect(client.updateBackupSettings({ intervalHours: 0 })).rejects.toThrow();
    await expect(client.updateBackupSettings({ keep: 99 })).rejects.toThrow();
  });
});

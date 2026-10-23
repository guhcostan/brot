import type { BackupEntry } from '../backups';
import { describe, expect, it } from 'vitest';
import { createHttpClient, type FetchLike } from './httpClient';

const at = '2026-10-19T09:00:00.000Z';
const entry = (overrides: Partial<BackupEntry> = {}): BackupEntry => ({
  name: 'brot-backup-2026-10-19-090000',
  createdAt: at,
  sizeBytes: 2_400_000,
  includesSecrets: true,
  ...overrides,
});

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

const json = (body: unknown, statusCode = 200) => new Response(JSON.stringify(body), { status: statusCode, headers: { 'Content-Type': 'application/json' } });

describe('backup routes', () => {
  it('reads the status and sorts backups newest first', async () => {
    const { fetch, calls } = fakeFetch(() =>
      json({
        settings: { enabled: true, intervalHours: 12, keep: 3, lastRunAt: at, lastBackupName: 'brot-backup-2' },
        backups: [entry({ name: 'brot-backup-1', createdAt: '2026-10-18T09:00:00.000Z' }), entry({ name: 'brot-backup-2' })],
        nextRunAt: '2026-10-20T09:00:00.000Z',
      }),
    );
    const client = createHttpClient({ fetch });

    const result = await client.getBackups();
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/api/backups' });
    expect(result.settings).toMatchObject({ enabled: true, intervalHours: 12, keep: 3, lastBackupName: 'brot-backup-2' });
    expect(result.backups.map((backup) => backup.name)).toEqual(['brot-backup-2', 'brot-backup-1']);
    expect(result.nextRunAt).toBe('2026-10-20T09:00:00.000Z');
  });

  it('falls back to defaults for malformed settings', async () => {
    const client = createHttpClient({ fetch: fakeFetch(() => json({ settings: { intervalHours: 500, keep: 0 } })).fetch });

    await expect(client.getBackups()).resolves.toMatchObject({
      settings: { enabled: false, intervalHours: 24, keep: 5 },
      backups: [],
    });
  });

  it('puts a partial settings patch', async () => {
    const { fetch, calls } = fakeFetch(() => json({ enabled: true, intervalHours: 48, keep: 5 }));
    const client = createHttpClient({ fetch });

    await expect(client.updateBackupSettings({ intervalHours: 48 })).resolves.toMatchObject({ intervalHours: 48, enabled: true });
    expect(calls[0]).toMatchObject({ method: 'PUT', path: '/api/backups', body: { intervalHours: 48 } });
  });

  it('rejects an empty or out-of-range patch before sending', async () => {
    const { fetch, calls } = fakeFetch(() => json({ enabled: true, intervalHours: 24, keep: 5 }));
    const client = createHttpClient({ fetch });

    await expect(client.updateBackupSettings({})).rejects.toThrow();
    await expect(client.updateBackupSettings({ intervalHours: 0 })).rejects.toThrow();
    await expect(client.updateBackupSettings({ intervalHours: 169 })).rejects.toThrow();
    await expect(client.updateBackupSettings({ keep: 31 })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('runs a backup now and reads the new entry; surfaces a 400', async () => {
    const { fetch, calls } = fakeFetch(() => json(entry(), 201));
    const client = createHttpClient({ fetch });

    await expect(client.runBackupNow()).resolves.toEqual(entry());
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/backups/run', body: {} });

    const refused = createHttpClient({ fetch: fakeFetch(() => json({ error: 'Backups are not writable' }, 400)).fetch });
    await expect(refused.runBackupNow()).rejects.toThrow('400 Backups are not writable');
  });

  it('rejects a malformed status entry', async () => {
    const client = createHttpClient({ fetch: fakeFetch(() => json({ settings: { enabled: true, intervalHours: 24, keep: 5 }, backups: [{ name: 'x' }] })).fetch });
    await expect(client.getBackups()).rejects.toThrow();
  });
});

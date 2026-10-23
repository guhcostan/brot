import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, createRepos, migrate, type BrotDb, type Repos } from '@brot/db';
import type { AdminActivity } from '@brot/protocol';
import type { Context } from 'hono';
import { isLocalRequest, type AppEnv } from '../auth';
import { activityActor, recordActivity } from './record';

let handle: BrotDb;
let repos: Repos;

beforeEach(async () => {
  handle = await createDb(':memory:');
  await migrate(handle.db);
  repos = createRepos(handle.db);
});

afterEach(() => {
  handle.client.close();
  vi.restoreAllMocks();
});

describe('recordActivity', () => {
  it('appends the entry with its actor and timestamp', async () => {
    await recordActivity(
      { repos },
      {
        action: 'created',
        targetType: 'bot',
        targetId: 'bot_1',
        summary: 'Created bot "Ada"',
        actor: 'local',
      },
    );

    const [entry] = await repos.adminActivity.list();
    expect(entry).toMatchObject({
      action: 'created',
      targetType: 'bot',
      targetId: 'bot_1',
      summary: 'Created bot "Ada"',
      actor: 'local',
    });
    expect(entry?.at).toBeDefined();
  });

  it('never throws when recording fails, and logs instead', async () => {
    const errors: Array<{ message: string; error: unknown }> = [];
    const failing: Repos['adminActivity'] = {
      record: async () => {
        throw new Error('database is locked');
      },
      list: async () => [],
    };

    await expect(
      recordActivity(
        { repos: { adminActivity: failing }, log: (message, error) => errors.push({ message, error }) },
        { action: 'deleted', targetType: 'bot', summary: 'Deleted bot "Ada"', actor: 'local' },
      ),
    ).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('could not record admin activity');
  });
});

describe('activityActor', () => {
  function fakeContext(options: { remote?: boolean; device?: { name: string } } = {}): Context<AppEnv> {
    return {
      env: options.remote === true ? { incoming: { socket: { remoteAddress: '203.0.113.9' } } } : undefined,
      get: (key: string) => (key === 'device' ? options.device : undefined),
    } as unknown as Context<AppEnv>;
  }

  it('is local for an in-process or loopback request', () => {
    expect(isLocalRequest(fakeContext(), true)).toBe(true);
    expect(activityActor(fakeContext(), true)).toBe('local');
    expect(activityActor(fakeContext({ device: { name: 'iPhone' } }), true)).toBe('local');
  });

  it('uses the paired device name for a remote request, and falls back to local', () => {
    expect(activityActor(fakeContext({ remote: true }), true)).toBe('local');
    expect(activityActor(fakeContext({ remote: true }), false)).toBe('local');
    expect(activityActor(fakeContext({ remote: true, device: { name: 'iPhone' } }), false)).toBe('iPhone');
  });

  it('records the actor it was given', async () => {
    await recordActivity(
      { repos },
      { action: 'revoked', targetType: 'device', targetId: 'dev_1', summary: 'Revoked device "iPhone"', actor: 'iPhone' },
    );
    const entries: AdminActivity[] = await repos.adminActivity.list();
    expect(entries[0]?.actor).toBe('iPhone');
  });
});

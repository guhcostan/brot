import { chmod, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureProfileDir, profileDir } from './profile';

const homes: string[] = [];

async function tempHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'brot-profile-'));
  homes.push(home);
  return home;
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

describe('profileDir', () => {
  it('puts a bot profile under browser-profiles', () => {
    expect(profileDir('/srv/brot', 'bot_1')).toBe(join('/srv/brot', 'browser-profiles', 'bot_1'));
  });

  it('refuses an id that would escape the profiles directory', () => {
    expect(() => profileDir('/srv/brot', '../escape')).toThrow(/profile directory name/);
    expect(() => profileDir('/srv/brot', 'bot/1')).toThrow(/profile directory name/);
    expect(() => profileDir('/srv/brot', '')).toThrow(/profile directory name/);
  });
});

describe('ensureProfileDir', () => {
  it('creates the profile readable only by the server user', async () => {
    const home = await tempHome();
    const dir = await ensureProfileDir(home, 'bot_1');
    expect(dir).toBe(join(home, 'browser-profiles', 'bot_1'));
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
  });

  it('tightens permissions on a profile directory that already existed', async () => {
    const home = await tempHome();
    const dir = profileDir(home, 'bot_1');
    await mkdir(dir, { recursive: true });
    await chmod(dir, 0o755);
    await ensureProfileDir(home, 'bot_1');
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
  });

  it('is idempotent', async () => {
    const home = await tempHome();
    const first = await ensureProfileDir(home, 'bot_1');
    expect(await ensureProfileDir(home, 'bot_1')).toBe(first);
  });
});

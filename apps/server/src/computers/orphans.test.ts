import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, createRepos, migrate, type BrotDb, type Repos } from '@brot/db';
import { startServer, type ServerHandle } from '../index';
import {
  parseSandboxContainers,
  selectOrphanContainers,
  sweepOrphanedSandboxContainers,
  type DockerExec,
  type DockerExecResult,
} from './orphans';

let handle: BrotDb;
let repos: Repos;

beforeEach(async () => {
  handle = await createDb(':memory:');
  await migrate(handle.db);
  repos = createRepos(handle.db);
});

afterEach(() => {
  handle.client.close();
});

function ok(stdout = ''): DockerExecResult {
  return { code: 0, stdout, stderr: '' };
}

/** A docker seam: `ps` answers the listing, everything else is recorded and answers through `onCommand`. */
function fakeDocker(listing: DockerExecResult, onCommand: (args: string[]) => DockerExecResult = () => ok()): {
  exec: DockerExec;
  calls: string[][];
} {
  const calls: string[][] = [];
  return {
    calls,
    async exec(args) {
      calls.push(args);
      if (args[0] === 'ps') return listing;
      return onCommand(args);
    },
  };
}

describe('parseSandboxContainers', () => {
  it('keeps only exact brot-computer-/brot-egress- names with a bot-id suffix', () => {
    const listing = [
      'brot-computer-bot_one',
      'brot-egress-bot_two',
      'brot-computer-',
      'brot-egress-',
      'brot-computer-bad/name',
      'brot-net-bot_one',
      'brot-workspace-bot_one',
      'user-postgres',
      'openmausbot-computer-x',
      `brot-computer-${'x'.repeat(70)}`,
      '',
    ].join('\n');

    expect(parseSandboxContainers(listing)).toEqual([
      { name: 'brot-computer-bot_one', botId: 'bot_one' },
      { name: 'brot-egress-bot_two', botId: 'bot_two' },
    ]);
  });
});

describe('selectOrphanContainers', () => {
  it('selects containers with no bot row or a bot that no longer uses a sandbox', () => {
    const containers = parseSandboxContainers(
      [
        'brot-computer-a',
        'brot-egress-a',
        'brot-computer-b',
        'brot-egress-b',
        'brot-computer-c',
        'brot-computer-gone',
      ].join('\n'),
    );
    const bots = new Map([
      ['a', { computer: 'sandbox' }],
      ['b', { computer: 'none' }],
      ['c', { computer: 'host' }],
    ]);
    expect(selectOrphanContainers(containers, bots).map((container) => container.name)).toEqual([
      'brot-computer-b',
      'brot-egress-b',
      'brot-computer-c',
      'brot-computer-gone',
    ]);
  });
});

describe('sweepOrphanedSandboxContainers', () => {
  it('removes only orphans, never a running sandbox bot or an unrelated container', async () => {
    const sandbox = await repos.bots.create({ name: 'Sandbox', job: 'x' });
    const none = await repos.bots.create({ name: 'No computer', job: 'x', computer: 'none' });
    const host = await repos.bots.create({ name: 'Host', job: 'x', computer: 'host', hostAcknowledged: true });
    const listing = [
      `brot-computer-${sandbox.id}`,
      `brot-egress-${sandbox.id}`,
      `brot-computer-${none.id}`,
      `brot-egress-${none.id}`,
      `brot-computer-${host.id}`,
      `brot-egress-${host.id}`,
      'brot-computer-bot_gone',
      'brot-egress-bot_gone',
      'user-container',
    ].join('\n');
    const docker = fakeDocker(ok(listing));
    const log: string[] = [];

    const result = await sweepOrphanedSandboxContainers({ repos, exec: docker.exec, log: (message) => log.push(message) });

    expect(result).toEqual({ removed: 6, skipped: false });
    const touched = docker.calls
      .filter((args) => args[0] === 'stop' || args[0] === 'rm')
      .map((args) => args[args.length - 1]);
    expect(touched.sort()).toEqual(
      [
        `brot-computer-${none.id}`,
        `brot-egress-${none.id}`,
        `brot-computer-${host.id}`,
        `brot-egress-${host.id}`,
        'brot-computer-bot_gone',
        'brot-egress-bot_gone',
        `brot-computer-${none.id}`,
        `brot-egress-${none.id}`,
        `brot-computer-${host.id}`,
        `brot-egress-${host.id}`,
        'brot-computer-bot_gone',
        'brot-egress-bot_gone',
      ].sort(),
    );
    expect(touched).not.toContain(`brot-computer-${sandbox.id}`);
    expect(touched).not.toContain('user-container');
    expect(log.some((message) => message.includes('removed 6 orphaned sandbox container(s)'))).toBe(true);
  });

  it('does nothing when no sandbox containers exist', async () => {
    const docker = fakeDocker(ok('user-container\nbrot-net-x\n'));
    const result = await sweepOrphanedSandboxContainers({ repos, exec: docker.exec, log: () => undefined });
    expect(result).toEqual({ removed: 0, skipped: false });
    expect(docker.calls).toEqual([['ps', '-a', '--format', '{{.Names}}']]);
  });

  it('skips quickly when docker cannot list containers', async () => {
    const docker = fakeDocker({ code: 1, stdout: '', stderr: 'Cannot connect to the Docker daemon' });
    const result = await sweepOrphanedSandboxContainers({ repos, exec: docker.exec, log: () => undefined });
    expect(result).toEqual({ removed: 0, skipped: true });
    expect(docker.calls).toHaveLength(1);
  });

  it('skips and logs when the docker command throws', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const result = await sweepOrphanedSandboxContainers({
        repos,
        exec: async () => {
          throw new Error('spawn docker ENOENT');
        },
      });
      expect(result).toEqual({ removed: 0, skipped: true });
      expect(errors.mock.calls.some((args) => String(args[0]).includes('could not sweep'))).toBe(true);
    } finally {
      errors.mockRestore();
    }
  });

  it('keeps going when removing one container fails', async () => {
    const listing = 'brot-computer-gone_a\nbrot-computer-gone_b\n';
    const docker = fakeDocker(ok(listing), (args) =>
      args[0] === 'rm' && args.includes('brot-computer-gone_a') ? { code: 1, stdout: '', stderr: 'in use' } : ok(),
    );
    const log: string[] = [];
    const result = await sweepOrphanedSandboxContainers({ repos, exec: docker.exec, log: (message) => log.push(message) });
    expect(result).toEqual({ removed: 1, skipped: false });
    expect(log.some((message) => message.includes('could not remove orphaned sandbox container brot-computer-gone_a'))).toBe(
      true,
    );
  });

  it('runs from startServer when explicitly enabled, with an injected docker', async () => {
    const home = await mkdtemp(join(tmpdir(), 'brot-orphan-sweep-'));
    const calls: string[][] = [];
    const exec: DockerExec = async (args) => {
      calls.push(args);
      if (args[0] === 'ps') return ok('brot-computer-bot_gone\nbrot-egress-bot_gone\nuser-container\n');
      return ok();
    };
    let server: ServerHandle | undefined;
    try {
      server = await startServer({
        home,
        host: '127.0.0.1',
        port: 0,
        webhookPort: 0,
        orphanSweep: { exec, log: () => undefined },
      });
      const deadline = Date.now() + 5000;
      while (!calls.some((args) => args[0] === 'rm')) {
        if (Date.now() > deadline) throw new Error('the boot sweep did not run');
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      const removed = calls.filter((args) => args[0] === 'rm').map((args) => args[args.length - 1]);
      expect(removed.sort()).toEqual(['brot-computer-bot_gone', 'brot-egress-bot_gone']);
      expect(calls.every((args) => !args.includes('user-container'))).toBe(true);
    } finally {
      await server?.close();
      await rm(home, { recursive: true, force: true });
    }
  });
});

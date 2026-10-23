import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDb, createRepos, migrate } from '@brot/db';
import { DEFAULT_URL, runCli, type CliDeps } from './cli';
import { capture, fakeFetch, json, unreachable } from './testing';

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function harness(overrides: Partial<CliDeps> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'brot-cli-args-'));
  dirs.push(dir);
  const stdout = capture();
  const stderr = capture();
  const deps: CliDeps = {
    env: { BROT_HOME: join(dir, 'home') },
    stdout,
    stderr,
    fetch: unreachable,
    signal: new AbortController().signal,
    start: vi.fn(async () => {
      throw new Error('EADDRINUSE: address already in use 127.0.0.1:8799');
    }),
    engines: [],
    nodeVersion: '24.15.0',
    ...overrides,
  };
  return { deps, stdout, stderr };
}

describe('runCli', () => {
  it('prints usage for --help and exits 0', async () => {
    const { deps, stdout, stderr } = await harness();

    expect(await runCli(['--help'], deps)).toBe(0);
    expect(stdout.text()).toContain('serve [--host <host>] [--port <port>]');
    expect(stdout.text()).toContain('backup [--out <dir>] [--no-secrets] [--force]');
    expect(stdout.text()).toContain('restore --from <dir> [--force]');
    expect(stdout.text()).toContain('--home <dir>');
    expect(stderr.text()).toBe('');
  });

  it('prints usage to stderr and exits 2 with no command', async () => {
    const { deps, stdout, stderr } = await harness();

    expect(await runCli([], deps)).toBe(2);
    expect(stderr.text()).toContain('Usage: brot <command>');
    expect(stdout.text()).toBe('');
  });

  it.each([
    [['bogus'], 'unknown command "bogus"'],
    [['serve', '--port', '70000'], '--port must be a port between 0 and 65535, got "70000"'],
    [['serve', '--port', 'abc'], '--port must be a port between 0 and 65535'],
    [['serve', 'extra'], 'serve takes no arguments'],
    [['doctor', '--bogus'], "Unknown option '--bogus'"],
    [['doctor', '--url', 'ftp://example.test'], '--url must start with http:// or https://'],
    [['doctor', '--url', 'not a url'], '--url is not a valid URL: not a url'],
    [['run', 'bot_1'], 'run needs a bot id and a message'],
    [['run'], 'run needs a bot id and a message'],
    [['restore'], 'restore needs --from <dir>'],
    [['backup', 'extra'], 'backup takes no arguments'],
    [['restore', '--from', 'x', 'extra'], 'restore takes no arguments'],
  ])('rejects %j with a usage error (exit 2)', async (argv, message) => {
    const { deps, stderr } = await harness();

    expect(await runCli(argv, deps)).toBe(2);
    expect(stderr.text()).toContain(message);
    expect(stderr.text()).toContain('Run "brot --help" for usage.');
  });

  it('exits 1 with the error message when a command fails at runtime', async () => {
    const { deps, stderr } = await harness();

    expect(await runCli(['serve', '--port', '8799'], deps)).toBe(1);
    expect(stderr.text()).toBe('brot: EADDRINUSE: address already in use 127.0.0.1:8799\n');
  });

  it('passes --port and --host to the server start function', async () => {
    const start = vi.fn(async () => {
      throw new Error('stop here');
    });
    const { deps } = await harness({ start });

    await runCli(['serve', '--host', '127.0.0.1', '--port', '0'], deps);
    expect(start).toHaveBeenCalledWith({ host: '127.0.0.1', port: 0 });
  });

  it('runs doctor against --url and prints JSON lines with --json', async () => {
    const { fetch } = fakeFetch({ 'GET /api/health': () => json({ ok: true, version: '0.1.0', protocol: 1 }) });
    const { deps, stdout } = await harness({ fetch });

    expect(await runCli(['doctor', '--json', '--url', 'http://127.0.0.1:9999/'], deps)).toBe(0);
    const server = stdout
      .text()
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { check: string; detail: string })
      .find((check) => check.check === 'server');
    expect(server?.detail).toBe('http://127.0.0.1:9999 runs Brot 0.1.0 (protocol 1)');
  });

  it('defaults the server URL to the protocol port on loopback', () => {
    expect(DEFAULT_URL).toBe('http://127.0.0.1:8799');
  });
});

describe('backup and restore commands', () => {
  async function makeHome(home: string): Promise<void> {
    await mkdir(home, { recursive: true });
    const db = await createDb(`file:${join(home, 'brot.db')}`);
    await migrate(db.db);
    const repos = createRepos(db.db);
    const bot = await repos.bots.create({ name: 'Ada', job: 'Researcher' });
    await repos.threads.create(bot.id, { title: 'Chat' });
    db.client.close();
  }

  it('backs up a home through the CLI and restores it into a new one', async () => {
    const { deps, stdout } = await harness();
    const home = deps.env.BROT_HOME;
    if (home === undefined) throw new Error('the harness needs a BROT_HOME');
    await makeHome(home);
    const out = join(home, 'cli-backup');

    expect(await runCli(['backup', '--out', out, '--no-secrets'], deps)).toBe(0);
    expect(stdout.text()).toContain(`Backup written to ${out}`);
    const manifest = JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8')) as {
      format: string;
      includesSecrets: boolean;
    };
    expect(manifest).toMatchObject({ format: 'brot-backup', includesSecrets: false });

    const target = join(home, 'restored');
    expect(await runCli(['restore', '--from', out, '--home', target], deps)).toBe(0);
    expect(stdout.text()).toContain('bots: 1');
    expect((await stat(join(target, 'brot.db'))).isFile()).toBe(true);
  });

  it('exits 1 with a clear message when there is no database to back up', async () => {
    const { deps, stderr } = await harness({ env: {} });
    const out = join(tmpdir(), `brot-cli-missing-${Date.now()}`);
    try {
      expect(await runCli(['backup', '--home', out, '--out', out], deps)).toBe(1);
      expect(stderr.text()).toContain('no database at');
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });
});

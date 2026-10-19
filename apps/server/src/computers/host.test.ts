import { mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Bot, ComputerProcess } from '@brot/protocol';
import { createHostComputerProvider } from './host';

const NODE = process.execPath;
const quiet = { extraHosts: [], onBlocked: () => undefined };
let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'brot-host-computer-'));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

function botFor(id: string): Bot {
  return {
    id,
    name: 'Test',
    job: 'test',
    instructions: '',
    engine: 'mock',
    computer: 'host',
    pinned: false,
    archived: false,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

async function feed(proc: ComputerProcess, text: string): Promise<void> {
  const writer = proc.stdin.getWriter();
  await writer.write(new TextEncoder().encode(text));
  await writer.close();
}

describe('host computer', () => {
  it('runs a command in the bot workspace and round-trips stdin and stdout', async () => {
    const provider = createHostComputerProvider({ brotHome: home });
    const handle = await provider.ensure(botFor('bot_echo'), quiet);
    const proc = await handle.exec([NODE, '-e', 'process.stdin.pipe(process.stdout)']);
    const output = readAll(proc.stdout);
    await feed(proc, 'hello computer');
    expect(await output).toBe('hello computer');
    expect(await proc.exit).toEqual({ code: 0, signal: null });
    await provider.close();
  });

  it('creates the workspace under BROT_HOME with owner-only permissions', async () => {
    const provider = createHostComputerProvider({ brotHome: home });
    await provider.ensure(botFor('bot_dir'), quiet);
    const info = await stat(join(home, 'workspaces', 'bot_dir'));
    expect(info.isDirectory()).toBe(true);
    expect(info.mode & 0o777).toBe(0o700);
    await provider.close();
  });

  it('does not pass the server environment to the command', async () => {
    process.env.BROT_TEST_SERVER_SECRET = 'hunter2';
    try {
      const provider = createHostComputerProvider({ brotHome: home });
      const handle = await provider.ensure(botFor('bot_env'), quiet);
      const proc = await handle.exec([NODE, '-e', 'process.stdout.write(JSON.stringify(process.env))']);
      const env = JSON.parse(await readAll(proc.stdout)) as Record<string, string>;
      expect(env.BROT_TEST_SERVER_SECRET).toBeUndefined();
      expect(env.HOME).toBe(join(home, 'workspaces', 'bot_env'));
      expect(JSON.stringify(env)).not.toContain('hunter2');
      await provider.close();
    } finally {
      delete process.env.BROT_TEST_SERVER_SECRET;
    }
  });

  it('confines the working directory to the workspace', async () => {
    const provider = createHostComputerProvider({ brotHome: home });
    const handle = await provider.ensure(botFor('bot_cwd'), quiet);
    await expect(handle.exec([NODE, '-e', '0'], { cwd: '/' })).rejects.toThrow(/outside the computer workspace/);
    await expect(handle.exec([NODE, '-e', '0'], { cwd: '../..' })).rejects.toThrow(/outside the computer workspace/);
    const inside = await handle.exec([NODE, '-e', 'process.stdout.write(process.cwd())'], { cwd: '.' });
    expect(await readAll(inside.stdout)).toBe(await realpath(join(home, 'workspaces', 'bot_cwd')));
    await provider.close();
  });

  it('refuses an empty command', async () => {
    const provider = createHostComputerProvider({ brotHome: home });
    const handle = await provider.ensure(botFor('bot_empty'), quiet);
    await expect(handle.exec([])).rejects.toThrow();
    await provider.close();
  });

  it('kills a running process on kill() and on stop(botId)', async () => {
    const provider = createHostComputerProvider({ brotHome: home });
    const handle = await provider.ensure(botFor('bot_kill'), quiet);
    const hung = await handle.exec([NODE, '-e', 'setInterval(() => {}, 1000)']);
    hung.kill('SIGKILL');
    expect((await hung.exit).signal).toBe('SIGKILL');

    const stopped = await handle.exec([NODE, '-e', 'setInterval(() => {}, 1000)']);
    await provider.stop('bot_kill');
    expect((await stopped.exit).signal).toBe('SIGTERM');
    await provider.close();
  });

  it('reports the unrestricted host as the Brot endpoint and always available', async () => {
    const provider = createHostComputerProvider({ brotHome: home, brotPort: 8799 });
    expect(await provider.available()).toEqual({ ok: true });
    expect(provider.internalEndpoint()).toEqual({ url: 'http://127.0.0.1:8799' });
    await provider.close();
  });

  it('keeps files written in the workspace on disk', async () => {
    const provider = createHostComputerProvider({ brotHome: home });
    const handle = await provider.ensure(botFor('bot_files'), quiet);
    const proc = await handle.exec([NODE, '-e', "require('fs').writeFileSync('note.txt', 'kept')"]);
    expect(await proc.exit).toEqual({ code: 0, signal: null });
    expect(await readFile(join(home, 'workspaces', 'bot_files', 'note.txt'), 'utf8')).toBe('kept');
    await provider.close();
  });
});

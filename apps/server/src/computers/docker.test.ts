import { execFile, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import type { Bot, ComputerHandle } from '@brot/protocol';
import { createDockerComputerProvider } from './docker';

const execFileAsync = promisify(execFile);

function dockerSucceeds(args: string[]): boolean {
  try {
    execFileSync('docker', args, { stdio: 'ignore', timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

/** The real-daemon suite runs only when the daemon answers and both images are built. */
const daemonUp = dockerSucceeds(['info']);
const imagesBuilt =
  daemonUp && dockerSucceeds(['image', 'inspect', 'brot-computer:latest']) && dockerSucceeds(['image', 'inspect', 'brot-egress:latest']);

function botFor(id: string): Bot {
  return {
    id,
    name: 'Test',
    job: 'test',
    instructions: '',
    engine: 'mock',
    computer: 'sandbox',
    egress: { mode: 'deny', allow: [] },
    pinned: false,
    archived: false,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

const quiet = { extraHosts: [], onBlocked: () => undefined };

describe('docker provider without a daemon', () => {
  it('reports unavailable and refuses to ensure when the docker CLI cannot run', async () => {
    const provider = createDockerComputerProvider({ dockerBin: '/nonexistent/brot-docker-cli' });
    const status = await provider.available();
    expect(status.ok).toBe(false);
    await expect(provider.ensure(botFor('bot_offline'), quiet)).rejects.toThrow(/unavailable/);
    await provider.close();
  });

  it('refuses an id that cannot be a container name, before touching docker', async () => {
    const provider = createDockerComputerProvider({ dockerBin: '/nonexistent/brot-docker-cli' });
    await expect(provider.ensure(botFor('../escape'), quiet)).rejects.toThrow(/container name/);
    await provider.close();
  });

  it('refuses an extra host that is not a valid egress entry', async () => {
    const provider = createDockerComputerProvider({ dockerBin: '/nonexistent/brot-docker-cli' });
    await expect(provider.ensure(botFor('bot_bad_host'), { extraHosts: ['10.0.0.1'], onBlocked: () => undefined })).rejects.toThrow();
    await provider.close();
  });

  it('gives the computer the sidecar relay as its Brot endpoint', () => {
    const provider = createDockerComputerProvider({ brotPort: 9000 });
    expect(provider.internalEndpoint()).toEqual({ url: 'http://brot-egress:9000' });
  });

  it('stops a bot that has no containers without throwing', async () => {
    // Deleting a bot calls stop even when its computer never started; docker failures are swallowed by stop.
    const provider = createDockerComputerProvider({ dockerBin: '/nonexistent/brot-docker-cli' });
    await expect(provider.stop('bot_without_containers')).resolves.toBeUndefined();
    await provider.close();
  });
});

async function run(handle: ComputerHandle, cmd: string[]): Promise<string> {
  const proc = await handle.exec(cmd);
  await proc.stdin.getWriter().close();
  const output = await new Response(proc.stdout).text();
  await proc.exit;
  return output;
}

async function waitFor(condition: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** Removes everything a test created for a bot. Best effort: a missing object is not a failure. */
async function removeBot(botId: string): Promise<void> {
  const names = [`brot-computer-${botId}`, `brot-egress-${botId}`];
  await execFileAsync('docker', ['rm', '--force', ...names]).catch(() => undefined);
  await execFileAsync('docker', ['network', 'rm', `brot-net-${botId}`]).catch(() => undefined);
  await execFileAsync('docker', ['volume', 'rm', '--force', `brot-workspace-${botId}`]).catch(() => undefined);
}

describe.skipIf(!imagesBuilt)('docker provider against a real daemon', () => {
  it('runs a computer that cannot reach the internet directly, and whose only proxy path is the allowlist', async () => {
    const botId = `test-${randomUUID().slice(0, 8)}`;
    const provider = createDockerComputerProvider({ brotPort: 18799 });
    const blocked: string[] = [];
    try {
      const handle = await provider.ensure(botFor(botId), { extraHosts: [], onBlocked: (host) => blocked.push(host) });
      expect((await run(handle, ['sh', '-c', 'echo ready'])).trim()).toBe('ready');
      // Without the proxy there is no route out at all.
      expect((await run(handle, ['sh', '-c', 'curl -sS --noproxy "*" --max-time 5 http://1.1.1.1/ >/dev/null 2>&1; echo $?'])).trim()).not.toBe('0');
      // Through the proxy, an IP literal is refused (curl -f turns the 403 into a failure).
      expect((await run(handle, ['sh', '-c', 'curl -sSf --max-time 5 http://1.1.1.1/ >/dev/null 2>&1; echo $?'])).trim()).not.toBe('0');
      expect((await run(handle, ['sh', '-c', 'curl -sSf --max-time 8 https://denied.example/ >/dev/null 2>&1; echo $?'])).trim()).not.toBe('0');
      await waitFor(() => blocked.includes('denied.example'), 15_000);
    } finally {
      await provider.stop(botId);
      await provider.close();
      await removeBot(botId);
    }
  }, 180_000);

  it('keeps the workspace across a restart of the computer', async () => {
    const botId = `test-${randomUUID().slice(0, 8)}`;
    const provider = createDockerComputerProvider();
    try {
      const first = await provider.ensure(botFor(botId), quiet);
      await run(first, ['sh', '-c', 'echo kept > /workspace/note.txt']);
      await provider.stop(botId);
      const second = await provider.ensure(botFor(botId), quiet);
      expect((await run(second, ['cat', '/workspace/note.txt'])).trim()).toBe('kept');
    } finally {
      await provider.stop(botId);
      await provider.close();
      await removeBot(botId);
    }
  }, 180_000);

  it('reaches the Brot endpoint through the relay, the only path to the host', async () => {
    const port = 18799;
    const server: Server = createServer((_req, res) => res.end('brot-endpoint-ok'));
    await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', () => resolve()));
    const botId = `test-${randomUUID().slice(0, 8)}`;
    const provider = createDockerComputerProvider({ brotPort: port });
    try {
      const handle = await provider.ensure(botFor(botId), quiet);
      const endpoint = provider.internalEndpoint().url;
      expect(await run(handle, ['sh', '-c', `curl -sS --max-time 8 ${endpoint}/mcp/runs/run_1`])).toContain('brot-endpoint-ok');
      expect(await run(handle, ['sh', '-c', `curl -sS -o /dev/null -w '%{http_code}' --max-time 8 ${endpoint}/api/threads`])).toBe('403');
    } finally {
      await provider.stop(botId);
      await provider.close();
      await removeBot(botId);
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 180_000);
});

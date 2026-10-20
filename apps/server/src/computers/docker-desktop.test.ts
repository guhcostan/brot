import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Bot, ComputerHandle } from '@brot/protocol';
import { createDockerComputerProvider } from './docker';
import { buildComputerRunArgs, DEFAULT_COMPUTER_RESOURCES, DESKTOP_IMAGE, fingerprint, SPEC_VERSION } from './docker-args';

function dockerSucceeds(args: string[]): boolean {
  try {
    execFileSync('docker', args, { stdio: 'ignore', timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

const daemonUp = dockerSucceeds(['info']);
const desktopBuilt = daemonUp && dockerSucceeds(['image', 'inspect', DESKTOP_IMAGE]) && dockerSucceeds(['image', 'inspect', 'brot-egress:latest']);

const DESKTOP_BOT = 'bot_desk01';

function botFor(id: string, desktop: boolean): Bot {
  return {
    id,
    name: 'Test',
    job: 'test',
    instructions: '',
    engine: 'mock',
    computer: 'sandbox',
    ...(desktop ? { desktop: true } : {}),
    egress: { mode: 'deny', allow: [] },
    pinned: false,
    archived: false,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

describe('desktop computer run arguments', () => {
  const base = { botId: DESKTOP_BOT, network: 'brot-net-x', resources: DEFAULT_COMPUTER_RESOURCES, fingerprint: 'f' };

  it('starts the desktop as the container command and keeps the container alive after it', () => {
    const args = buildComputerRunArgs({ ...base, image: DESKTOP_IMAGE, desktop: true });
    expect(args.slice(-3)).toEqual(['sh', '-c', 'brot-desktop-start && exec sleep infinity']);
    expect(args).toContain(DESKTOP_IMAGE);
  });

  it('keeps the plain sleep command for a computer without a desktop', () => {
    const args = buildComputerRunArgs({ ...base, image: 'brot-computer:latest' });
    expect(args.slice(-2)).toEqual(['sleep', 'infinity']);
  });

  it('keeps the hardening flags on a desktop computer', () => {
    const args = buildComputerRunArgs({ ...base, image: DESKTOP_IMAGE, desktop: true });
    expect(args).toContain('--read-only');
    expect(args.join(' ')).toContain('--cap-drop ALL');
    expect(args.join(' ')).toContain('--user 1000:1000');
    expect(args.join(' ')).not.toContain('--privileged');
  });

  it('folds desktop into the fingerprint, so a desktop bot never reuses a plain container', () => {
    const plain = fingerprint({ v: SPEC_VERSION, role: 'computer', image: 'brot-computer:latest', resources: DEFAULT_COMPUTER_RESOURCES });
    const desk = fingerprint({ v: SPEC_VERSION, role: 'computer', image: DESKTOP_IMAGE, resources: DEFAULT_COMPUTER_RESOURCES, desktop: true });
    expect(desk).not.toBe(plain);
  });
});

describe('desktop provider without a daemon', () => {
  it('refuses a desktop bot when docker cannot run, before any container work', async () => {
    const provider = createDockerComputerProvider({ dockerBin: '/nonexistent/brot-docker-cli' });
    await expect(provider.ensure(botFor('bot_desk_off', true), { extraHosts: [], onBlocked: () => undefined })).rejects.toThrow(/unavailable/);
    await provider.close();
  });
});

async function runText(handle: ComputerHandle, cmd: string[], env?: Record<string, string>): Promise<{ stdout: Uint8Array; code: number | null }> {
  const proc = await handle.exec(cmd, env === undefined ? {} : { env });
  await proc.stdin.getWriter().close();
  const stdout = new Uint8Array(await new Response(proc.stdout).arrayBuffer());
  const exit = await proc.exit;
  return { stdout, code: exit.code };
}

describe.skipIf(!desktopBuilt)('desktop provider against a real daemon', () => {
  it('starts the desktop, captures a 1280x800 JPEG, and reaches the browser over CDP', async () => {
    const botId = `test-desk-${randomUUID().slice(0, 8)}`;
    const provider = createDockerComputerProvider({ brotPort: 18799 });
    try {
      const handle = await provider.ensure(botFor(botId, true), { extraHosts: [], onBlocked: () => undefined });
      const start = await runText(handle, ['brot-desktop-start']);
      expect(start.code).toBe(0);
      const frame = await runText(handle, ['import', '-window', 'root', '-quality', '70', 'jpeg:-'], { DISPLAY: ':1' });
      expect(frame.code).toBe(0);
      expect(Array.from(frame.stdout.subarray(0, 2))).toEqual([0xff, 0xd8]);
      const opened = await runText(handle, ['brot-browser', 'open', JSON.stringify({ url: 'about:blank' })], { DISPLAY: ':1' });
      expect(opened.code).toBe(0);
      expect(new TextDecoder().decode(opened.stdout)).toContain('"url":"about:blank"');
    } finally {
      await provider.stop(botId);
      await provider.close();
      await execFileSyncSafe(['rm', '--force', `brot-computer-${botId}`, `brot-egress-${botId}`]);
      await execFileSyncSafe(['network', 'rm', `brot-net-${botId}`]);
      await execFileSyncSafe(['volume', 'rm', '--force', `brot-workspace-${botId}`]);
    }
  }, 180_000);
});

async function execFileSyncSafe(args: string[]): Promise<void> {
  try {
    execFileSync('docker', args, { stdio: 'ignore', timeout: 15_000 });
  } catch {
    // Best effort cleanup: a missing object is not a failure.
  }
}

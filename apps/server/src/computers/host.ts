import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import type { ComputerExecOptions, ComputerHandle, ComputerProcess } from '@brot/protocol';
import { assertBotId } from './docker-args';
import { toComputerProcess } from './stdio';
import type { ComputerProvider } from './types';

export interface HostProviderOptions {
  /** The Brot data directory. Each bot's workspace is `<brotHome>/workspaces/<botId>`. */
  brotHome: string;
  /** Port the Brot server listens on, as seen from the host. Default 8799. */
  brotPort?: number;
}

/**
 * The `host` computer: commands run as local processes of the Brot server's user, in the bot's workspace.
 *
 * Nothing is contained here. There is no container, no network isolation and no egress enforcement, so a
 * bot on `host` can reach anything this machine can. That is why `computer: host` needs explicit acknowledgement.
 * The one thing this provider does is keep the environment small: the child gets PATH, a UTF-8 locale and
 * `HOME` set to its workspace, not the server's environment, so server secrets are not inherited.
 */
export function createHostComputerProvider(opts: HostProviderOptions): ComputerProvider {
  const brotPort = opts.brotPort ?? 8799;
  const children = new Map<string, Set<ChildProcess>>();

  function track(botId: string, child: ChildProcess): void {
    let set = children.get(botId);
    if (set === undefined) {
      set = new Set();
      children.set(botId, set);
    }
    set.add(child);
    child.once('close', () => set?.delete(child));
  }

  function killChildren(botId: string): void {
    for (const child of children.get(botId) ?? []) child.kill('SIGTERM');
    children.delete(botId);
  }

  function resolveCwd(workspace: string, cwd: string | undefined): string {
    const target = resolve(workspace, cwd ?? '.');
    if (target !== workspace && !target.startsWith(`${workspace}${sep}`)) {
      throw new Error('cwd is outside the computer workspace');
    }
    return target;
  }

  function execIn(botId: string, workspace: string, cmd: string[], execOpts: ComputerExecOptions = {}): ComputerProcess {
    const [file, ...args] = cmd;
    if (file === undefined || cmd.some((arg) => arg.includes('\0'))) {
      throw new Error('command must be a non-empty list of strings');
    }
    const child = spawn(file, args, {
      cwd: resolveCwd(workspace, execOpts.cwd),
      env: { PATH: process.env.PATH ?? '', LANG: 'C.UTF-8', HOME: workspace, ...execOpts.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
    });
    track(botId, child);
    return toComputerProcess(child, (signal) => child.kill(signal));
  }

  return {
    id: 'host',

    available: async () => ({ ok: true }),

    async ensure(bot): Promise<ComputerHandle> {
      const botId = assertBotId(bot.id);
      const workspace = join(opts.brotHome, 'workspaces', botId);
      await mkdir(workspace, { recursive: true, mode: 0o700 });
      return {
        id: `host:${botId}`,
        exec: async (cmd, execOpts) => execIn(botId, workspace, cmd, execOpts),
      };
    },

    internalEndpoint: () => ({ url: `http://127.0.0.1:${brotPort}` }),

    async stop(botId: string): Promise<void> {
      killChildren(assertBotId(botId));
    },

    async close(): Promise<void> {
      for (const botId of [...children.keys()]) killChildren(botId);
    },
  };
}

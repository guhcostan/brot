import { execFile } from 'node:child_process';
import type { Repos } from '@brot/db';
import { isBotId } from './docker-args';

/** The only container name prefixes Brot's sandbox creates. A sweep never looks at anything else. */
export const SANDBOX_CONTAINER_PREFIXES = ['brot-computer-', 'brot-egress-'] as const;

export interface SandboxContainer {
  /** The full docker container name. */
  name: string;
  botId: string;
}

/** A docker invocation result. Any failure resolves with a nonzero code instead of rejecting. */
export interface DockerExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** The docker command seam: `exec` runs `docker <args>` and never rejects. Tests inject a fake. */
export type DockerExec = (args: string[]) => Promise<DockerExecResult>;

/**
 * Parses `docker ps -a --format '{{.Names}}'` output. Only exact `brot-computer-<botId>` and
 * `brot-egress-<botId>` names with a bot-id-shaped suffix are recognized; every other container (the user's,
 * OpenMausBot's, `brot-net-*`, `brot-workspace-*`) is ignored.
 */
export function parseSandboxContainers(output: string): SandboxContainer[] {
  const containers: SandboxContainer[] = [];
  for (const line of output.split('\n')) {
    const name = line.trim();
    if (name === '') continue;
    for (const prefix of SANDBOX_CONTAINER_PREFIXES) {
      if (!name.startsWith(prefix)) continue;
      const botId = name.slice(prefix.length);
      if (isBotId(botId)) containers.push({ name, botId });
      break;
    }
  }
  return containers;
}

/**
 * The containers that must go: the database has no bot for them (the bot was deleted, or its row belongs to
 * another installation), or its bot no longer runs a sandbox computer (it became `none` or `host`).
 */
export function selectOrphanContainers(
  containers: readonly SandboxContainer[],
  bots: ReadonlyMap<string, { computer: string }>,
): SandboxContainer[] {
  return containers.filter((container) => {
    const bot = bots.get(container.botId);
    return bot === undefined || bot.computer !== 'sandbox';
  });
}

export interface OrphanSweepOptions {
  /** Docker seam. Defaults to the docker CLI. */
  exec?: DockerExec;
  /** Where progress is logged. Defaults to console.log; tests pass a recorder. */
  log?: (message: string) => void;
}

export interface OrphanSweepDeps extends OrphanSweepOptions {
  repos: Repos;
}

export interface OrphanSweepResult {
  /** Containers actually removed. */
  removed: number;
  /** True when docker could not be listed at all (no daemon, no CLI); nothing was touched. */
  skipped: boolean;
}

/** Runs the docker CLI through execFile. Nothing is ever passed through a shell, and failures resolve. */
function dockerCli(args: string[]): Promise<DockerExecResult> {
  return new Promise((resolve) => {
    execFile(
      'docker',
      args,
      { encoding: 'utf8', timeout: 30_000, windowsHide: true },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ code: 0, stdout, stderr });
          return;
        }
        resolve({
          code: typeof error.code === 'number' ? error.code : 1,
          stdout,
          stderr: stderr || error.message,
        });
      },
    );
  });
}

/**
 * Stops and removes sandbox containers left behind by deleted bots or bots that stopped using a sandbox computer.
 * Only `brot-computer-<botId>` and `brot-egress-<botId>` names are touched; anything else on the daemon is left
 * alone. Every docker call is best effort: a missing daemon or a failing command only logs, and this function
 * never throws, so boot continues. Runs the equivalent of
 * `docker ps -a --format '{{.Names}}'`, then `docker stop --time 5 <name>` and `docker rm --force <name>` per orphan.
 */
export async function sweepOrphanedSandboxContainers(deps: OrphanSweepDeps): Promise<OrphanSweepResult> {
  const exec = deps.exec ?? dockerCli;
  const log = deps.log ?? ((message: string) => console.log(message));
  try {
    const listed = await exec(['ps', '-a', '--format', '{{.Names}}']);
    if (listed.code !== 0) return { removed: 0, skipped: true };
    const containers = parseSandboxContainers(listed.stdout);
    if (containers.length === 0) return { removed: 0, skipped: false };

    const known = new Map<string, { computer: string }>();
    for (const botId of new Set(containers.map((container) => container.botId))) {
      const bot = await deps.repos.bots.get(botId);
      if (bot !== undefined) known.set(botId, { computer: bot.computer });
    }
    let removed = 0;
    for (const container of selectOrphanContainers(containers, known)) {
      await exec(['stop', '--time', '5', container.name]);
      const result = await exec(['rm', '--force', container.name]);
      if (result.code === 0) removed += 1;
      else log(`could not remove orphaned sandbox container ${container.name}: ${result.stderr.trim()}`);
    }
    if (removed > 0) log(`removed ${removed} orphaned sandbox container(s)`);
    return { removed, skipped: false };
  } catch (error) {
    // Reclaiming containers is housekeeping: a failure must never keep Brot from starting.
    console.error('could not sweep orphaned sandbox containers', error);
    return { removed: 0, skipped: true };
  }
}

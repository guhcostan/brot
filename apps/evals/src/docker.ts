import { execFile } from 'node:child_process';

/** Matches the names the server gives a bot's resources (apps/server/src/computers/docker-args.ts). */
export const computerName = (botId: string): string => `brot-computer-${botId}`;
export const egressName = (botId: string): string => `brot-egress-${botId}`;
export const networkName = (botId: string): string => `brot-net-${botId}`;
export const workspaceVolumeName = (botId: string): string => `brot-workspace-${botId}`;

export const WORKSPACE = '/workspace';

export class DockerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DockerError';
  }
}

export interface Exec {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs the docker CLI with an argv array. Nothing goes through a shell. */
export function docker(args: string[], options: { timeoutMs?: number; input?: string } = {}): Promise<Exec> {
  return new Promise((resolve) => {
    const child = execFile(
      'docker',
      args,
      { timeout: options.timeoutMs ?? 120_000, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1;
        resolve({ code, stdout: String(stdout), stderr: String(stderr || (error ? error.message : '')) });
      },
    );
    if (options.input !== undefined) child.stdin?.end(options.input);
  });
}

/**
 * Fails clearly when the Docker daemon is not reachable. Fixture copies and the computer checks need it, so the
 * runner calls this before it starts a case. Returns the server version.
 */
export async function requireDocker(): Promise<string> {
  const result = await docker(['version', '--format', '{{.Server.Version}}'], { timeoutMs: 20_000 });
  if (result.code !== 0 || result.stdout.trim() === '') {
    throw new DockerError(
      'Docker is not reachable, so the eval runner cannot copy fixtures into bot computers or check their files. ' +
        'Start the daemon (with Colima: `colima start --cpu 4 --memory 8`) and make sure `docker version` works. ' +
        `Docker said: ${result.stderr.trim().split('\n')[0] ?? 'no output'}`,
    );
  }
  return result.stdout.trim();
}

export type ContainerState = 'running' | 'exited' | 'missing';

export async function containerState(name: string): Promise<ContainerState> {
  const result = await docker(['inspect', '--format', '{{.State.Running}}', name]);
  if (result.code !== 0) return 'missing';
  return result.stdout.trim() === 'true' ? 'running' : 'exited';
}

/**
 * Runs a command inside a container as the computer's own user. The computer drops capabilities, so root cannot write
 * into the workspace volume, which the computer user owns.
 */
export function execIn(name: string, command: string, options: { timeoutMs?: number } = {}): Promise<Exec> {
  return docker(['exec', '-w', WORKSPACE, name, 'sh', '-c', command], { timeoutMs: options.timeoutMs ?? 120_000 });
}

/**
 * Copies a local file into the container. The parent directory is created as the computer user, who owns the
 * workspace. The copied file keeps the host's owner, and it stays readable for the computer user.
 */
export async function copyIntoContainer(name: string, localPath: string, containerPath: string): Promise<void> {
  const parent = containerPath.slice(0, containerPath.lastIndexOf('/')) || '/';
  const made = await execIn(name, `mkdir -p "${parent}"`);
  if (made.code !== 0) throw new DockerError(`could not create ${parent} in ${name}: ${made.stderr.trim()}`);
  const copied = await docker(['cp', localPath, `${name}:${containerPath}`]);
  if (copied.code !== 0) throw new DockerError(`docker cp into ${name}:${containerPath} failed: ${copied.stderr.trim()}`);
}

/** Copies a file or directory out of a container. Returns false when the path does not exist. */
export async function copyOutOfContainer(name: string, containerPath: string, localPath: string): Promise<boolean> {
  const result = await docker(['cp', `${name}:${containerPath}`, localPath]);
  return result.code === 0;
}

/**
 * Removes the containers, network and workspace volume of one bot. Containers go first, since a network or volume
 * in use cannot be removed. Returns the names that were removed.
 */
export async function removeBotResources(botId: string): Promise<string[]> {
  const removed: string[] = [];
  for (const name of [computerName(botId), egressName(botId)]) {
    const result = await docker(['rm', '-f', name]);
    if (result.code === 0) removed.push(name);
  }
  const network = await docker(['network', 'rm', networkName(botId)]);
  if (network.code === 0) removed.push(networkName(botId));
  const volume = await docker(['volume', 'rm', workspaceVolumeName(botId)]);
  if (volume.code === 0) removed.push(workspaceVolumeName(botId));
  return removed;
}

/** Names of every container, network and volume whose name starts with `brot-`. Used to report leftovers. */
export async function listBrotResources(): Promise<string[]> {
  const containers = await docker(['ps', '-a', '--filter', 'name=brot-', '--format', '{{.Names}}']);
  const networks = await docker(['network', 'ls', '--filter', 'name=brot-', '--format', '{{.Name}}']);
  const volumes = await docker(['volume', 'ls', '--filter', 'name=brot-', '--format', '{{.Name}}']);
  return [containers, networks, volumes]
    .flatMap((result) => result.stdout.split('\n'))
    .map((line) => line.trim())
    .filter((line) => line.startsWith('brot-'));
}

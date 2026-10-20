import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EgressHost, type Bot, type ComputerExecOptions, type ComputerHandle, type ComputerProcess, type EgressPolicy } from '@brot/protocol';
import {
  assertBotId,
  BUILD_COMPUTER_IMAGE,
  BUILD_DESKTOP_IMAGE,
  BUILD_EGRESS_IMAGE,
  buildComputerRunArgs,
  buildEgressRunArgs,
  buildExecArgs,
  buildImageInspectArgs,
  buildInspectArgs,
  buildLogsArgs,
  buildNetworkConnectArgs,
  buildNetworkCreateArgs,
  buildRemoveArgs,
  buildStartArgs,
  buildStopArgs,
  buildVersionArgs,
  buildVolumeCreateArgs,
  COMPUTER_IMAGE,
  computerName,
  DEFAULT_COMPUTER_RESOURCES,
  DESKTOP_IMAGE,
  EGRESS_ALIAS,
  EGRESS_IMAGE,
  EGRESS_PORT,
  EGRESS_RESOURCES,
  egressName,
  FINGERPRINT_LABEL,
  fingerprint,
  HOST_ALIAS,
  networkName,
  parseBlockedLine,
  SPEC_VERSION,
  type ComputerResources,
} from './docker-args';
import type { SidecarConfig } from './egress-proxy';
import { toComputerProcess } from './stdio';
import { effectiveAllowlist, type ComputerProvider } from './types';

export interface DockerProviderOptions {
  /** Port the Brot server listens on. The computer reaches it through the sidecar relay. Default 8799. */
  brotPort?: number;
  computerImage?: string;
  /** The image for bots with `desktop: true`. Default `brot-desktop:latest`. */
  desktopImage?: string;
  egressImage?: string;
  /** The docker CLI binary. Default `docker`. */
  dockerBin?: string;
  resources?: Partial<ComputerResources>;
}

interface DockerResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface NetworkInfo {
  name: string;
  subnet: string;
}

interface ContainerInfo {
  running: boolean;
  labels: Record<string, string>;
  networks: string[];
}

/**
 * Kills processes inside the computer that carry the exec's `BROT_EXEC_ID` environment variable. Killing the
 * local `docker exec` client does not stop the process it started, so the environment marker finds it.
 */
const KILL_SCRIPT = [
  'for p in /proc/[0-9]*; do',
  '  if tr "\\0" "\\n" < "$p/environ" 2>/dev/null | grep -qx "BROT_EXEC_ID=$1"; then',
  '    kill -s "$2" "${p#/proc/}" 2>/dev/null',
  '  fi',
  'done',
].join('\n');

const LOG_LINE_LIMIT = 65_536;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asRecord = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

const firstLine = (text: string): string => text.trim().split('\n')[0] ?? '';

function egressAllowlist(policy: EgressPolicy | undefined, extraHosts: readonly string[]): string[] {
  return effectiveAllowlist(policy, [...extraHosts]).map((host) => EgressHost.parse(host));
}

/**
 * The Docker computer provider. It shells out to the docker CLI with argv arrays (never a shell string).
 * The CLI is used instead of dockerode so the server gains no dependency, and `docker exec -i` gives the stdio
 * streams directly. Each bot gets three things: a computer container on an `--internal` network, a sidecar
 * that is the only way out (see egress-proxy.ts), and a persistent workspace volume.
 */
export function createDockerComputerProvider(opts: DockerProviderOptions = {}): ComputerProvider {
  const bin = opts.dockerBin ?? 'docker';
  const brotPort = opts.brotPort ?? 8799;
  const computerImage = opts.computerImage ?? COMPUTER_IMAGE;
  const desktopImage = opts.desktopImage ?? DESKTOP_IMAGE;
  const egressImage = opts.egressImage ?? EGRESS_IMAGE;
  const resources: ComputerResources = { ...DEFAULT_COMPUTER_RESOURCES, ...opts.resources };
  const started = new Set<string>();
  const followers = new Map<string, ChildProcess>();
  const sinks = new Map<string, (host: string) => void>();
  const locks = new Map<string, Promise<void>>();
  let closed = false;

  function docker(args: string[], timeoutMs = 120_000): Promise<DockerResult> {
    return new Promise((resolve) => {
      execFile(bin, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
        if (error === null) {
          resolve({ code: 0, stdout, stderr });
          return;
        }
        resolve({ code: typeof error.code === 'number' ? error.code : 1, stdout, stderr: stderr || error.message });
      });
    });
  }

  async function mustDocker(args: string[], what: string): Promise<void> {
    const result = await docker(args);
    if (result.code !== 0) throw new Error(`${what} failed: ${firstLine(result.stderr)}`);
  }

  function withBotLock<T>(botId: string, work: () => Promise<T>): Promise<T> {
    const previous = locks.get(botId) ?? Promise.resolve();
    const current = previous.then(work);
    locks.set(
      botId,
      current.then(
        () => undefined,
        () => undefined,
      ),
    );
    return current;
  }

  async function inspect(kind: 'container' | 'network', name: string): Promise<Record<string, unknown> | undefined> {
    const result = await docker(buildInspectArgs(kind, name));
    if (result.code !== 0) return undefined;
    try {
      const value: unknown = JSON.parse(result.stdout);
      return isRecord(value) ? value : undefined;
    } catch {
      return undefined;
    }
  }

  async function inspectContainer(name: string): Promise<ContainerInfo | undefined> {
    const raw = await inspect('container', name);
    if (raw === undefined) return undefined;
    const labels: Record<string, string> = {};
    for (const [key, value] of Object.entries(asRecord(asRecord(raw.Config).Labels))) {
      if (typeof value === 'string') labels[key] = value;
    }
    return {
      running: asRecord(raw.State).Running === true,
      labels,
      networks: Object.keys(asRecord(asRecord(raw.NetworkSettings).Networks)),
    };
  }

  async function inspectNetwork(name: string): Promise<{ internal: boolean; subnet: string | undefined } | undefined> {
    const raw = await inspect('network', name);
    if (raw === undefined) return undefined;
    const configs = asRecord(raw.IPAM).Config;
    const subnet = Array.isArray(configs) ? asRecord(configs[0]).Subnet : undefined;
    return { internal: raw.Internal === true, subnet: typeof subnet === 'string' ? subnet : undefined };
  }

  async function startContainer(name: string): Promise<void> {
    await mustDocker(buildStartArgs(name), `start ${name}`);
    started.add(name);
  }

  async function runContainer(args: string[], name: string): Promise<void> {
    await mustDocker(args, `run ${name}`);
    started.add(name);
  }

  async function removeContainer(name: string): Promise<void> {
    await docker(buildRemoveArgs(name));
    started.delete(name);
  }

  function stopFollower(botId: string): void {
    const child = followers.get(botId);
    if (child === undefined) return;
    followers.delete(botId);
    child.kill('SIGTERM');
  }

  /** Reads the sidecar's log for refused hosts and forwards each one to the bot's current `onBlocked`. */
  function startFollower(botId: string, name: string): void {
    if (followers.has(botId)) return;
    const child = spawn(bin, buildLogsArgs(name), { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    followers.set(botId, child);
    let pending = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      pending += chunk.toString('utf8');
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      if (pending.length > LOG_LINE_LIMIT) pending = '';
      for (const line of lines) {
        const host = parseBlockedLine(line);
        if (host !== undefined) sinks.get(botId)?.(host);
      }
    });
    child.stdout?.on('error', () => undefined);
    child.stderr?.on('data', () => undefined);
    child.on('error', () => undefined);
    child.once('close', () => {
      if (followers.get(botId) === child) followers.delete(botId);
    });
  }

  async function requireReady(desktop: boolean): Promise<void> {
    const status = await available();
    if (!status.ok) throw new Error(`Docker computer is unavailable: ${status.reason}`);
    const images: ReadonlyArray<readonly [string, string]> = [
      [computerImage, BUILD_COMPUTER_IMAGE],
      [egressImage, BUILD_EGRESS_IMAGE],
      ...(desktop ? [[desktopImage, BUILD_DESKTOP_IMAGE] as const] : []),
    ];
    for (const [image, hint] of images) {
      if ((await docker(buildImageInspectArgs(image))).code !== 0) {
        throw new Error(`image ${image} is not built. Run: ${hint}`);
      }
    }
  }

  async function available(): Promise<{ ok: true } | { ok: false; reason: string }> {
    const result = await docker(buildVersionArgs(), 15_000);
    return result.code === 0 ? { ok: true } : { ok: false, reason: firstLine(result.stderr) || 'Docker is not reachable' };
  }

  async function ensureNetwork(botId: string): Promise<NetworkInfo> {
    const name = networkName(botId);
    let info = await inspectNetwork(name);
    if (info === undefined) {
      await mustDocker(buildNetworkCreateArgs(botId), `create network ${name}`);
      info = await inspectNetwork(name);
    }
    if (info === undefined || !info.internal) {
      throw new Error(`network ${name} must be internal; remove it so Brot can recreate it`);
    }
    if (info.subnet === undefined) throw new Error(`network ${name} has no subnet`);
    return { name, subnet: info.subnet };
  }

  async function ensureEgress(botId: string, allow: string[], network: NetworkInfo): Promise<void> {
    const name = egressName(botId);
    const config: SidecarConfig = {
      allow,
      internal: { host: HOST_ALIAS, port: brotPort },
      subnet: network.subnet,
      proxyPort: EGRESS_PORT,
    };
    const spec = fingerprint({ v: SPEC_VERSION, role: 'egress', image: egressImage, config, resources: EGRESS_RESOURCES });
    const current = await inspectContainer(name);
    if (current?.labels[FINGERPRINT_LABEL] === spec && current.networks.includes(network.name)) {
      if (!current.running) await startContainer(name);
    } else {
      stopFollower(botId);
      await removeContainer(name);
      await runContainer(buildEgressRunArgs({ botId, image: egressImage, config, fingerprint: spec }), name);
      await mustDocker(buildNetworkConnectArgs(network.name, name), `connect ${name} to ${network.name}`);
    }
    startFollower(botId, name);
  }

  async function ensureComputer(bot: Bot, network: NetworkInfo): Promise<void> {
    const botId = bot.id;
    const name = computerName(botId);
    const desktop = bot.desktop === true;
    const image = desktop ? desktopImage : computerImage;
    // `desktop` joins the fingerprint only when set, so the hash of an existing non-desktop computer is unchanged.
    const spec = fingerprint({ v: SPEC_VERSION, role: 'computer', image, resources, ...(desktop ? { desktop: true } : {}) });
    const current = await inspectContainer(name);
    if (current?.labels[FINGERPRINT_LABEL] === spec && current.networks.includes(network.name)) {
      if (!current.running) await startContainer(name);
      return;
    }
    await removeContainer(name);
    await runContainer(
      buildComputerRunArgs({ botId, image, network: network.name, resources, fingerprint: spec, desktop }),
      name,
    );
  }

  async function execIn(name: string, cmd: string[], execOpts: ComputerExecOptions = {}): Promise<ComputerProcess> {
    const execId = randomUUID();
    const args = buildExecArgs(name, cmd, { cwd: execOpts.cwd, env: { ...execOpts.env, BROT_EXEC_ID: execId } });
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    return toComputerProcess(child, (signal) => {
      child.kill(signal);
      void docker(['exec', name, 'sh', '-c', KILL_SCRIPT, 'sh', execId, signal], 15_000);
    });
  }

  return {
    id: 'docker',

    available,

    async ensure(bot: Bot, call: { extraHosts: string[]; onBlocked(host: string): void }): Promise<ComputerHandle> {
      if (closed) throw new Error('computer provider is closed');
      const botId = assertBotId(bot.id);
      const allow = egressAllowlist(bot.egress, call.extraHosts);
      return withBotLock(botId, async () => {
        await requireReady(bot.desktop === true);
        sinks.set(botId, call.onBlocked);
        await mustDocker(buildVolumeCreateArgs(botId), `create workspace volume for ${botId}`);
        const network = await ensureNetwork(botId);
        await ensureEgress(botId, allow, network);
        await ensureComputer(bot, network);
        const name = computerName(botId);
        return {
          id: name,
          exec: (cmd, execOpts) => execIn(name, cmd, execOpts),
        };
      });
    },

    internalEndpoint: () => ({ url: `http://${EGRESS_ALIAS}:${brotPort}` }),

    async stop(botId: string): Promise<void> {
      const id = assertBotId(botId);
      await withBotLock(id, async () => {
        stopFollower(id);
        for (const name of [computerName(id), egressName(id)]) {
          await docker(buildStopArgs(name));
          started.delete(name);
        }
      });
    },

    async close(): Promise<void> {
      closed = true;
      for (const botId of [...followers.keys()]) stopFollower(botId);
      await Promise.all([...started].map((name) => docker(buildStopArgs(name))));
      started.clear();
    },
  };
}

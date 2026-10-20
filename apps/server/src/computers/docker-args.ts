import { createHash } from 'node:crypto';
import type { SidecarConfig } from './egress-proxy';

/** Every docker invocation is built here as an argv array. Nothing is ever passed through a shell. */

export const COMPUTER_IMAGE = 'brot-computer:latest';
export const EGRESS_IMAGE = 'brot-egress:latest';
export const BUILD_COMPUTER_IMAGE = 'docker build -t brot-computer:latest images/computer';
export const BUILD_EGRESS_IMAGE =
  'docker build -f images/computer/egress.Dockerfile -t brot-egress:latest apps/server/src/computers';
export const DESKTOP_IMAGE = 'brot-desktop:latest';
export const BUILD_DESKTOP_IMAGE = 'docker build -t brot-desktop:latest images/desktop';
/** A desktop computer starts its screen with its own command, then keeps running the way `sleep infinity` does. */
export const DESKTOP_COMMAND = ['sh', '-c', 'brot-desktop-start && exec sleep infinity'];

export const COMPUTER_UID = 1000;
export const COMPUTER_USER = `${COMPUTER_UID}:${COMPUTER_UID}`;
export const WORKSPACE_PATH = '/workspace';
export const HOME_PATH = '/home/node';
export const EGRESS_PORT = 3128;
export const EGRESS_ALIAS = 'brot-egress';
export const HOST_ALIAS = 'host.docker.internal';
export const FINGERPRINT_LABEL = 'brot.fingerprint';

/** Bump when the shape of a container's run arguments changes, so existing containers are recreated. */
export const SPEC_VERSION = 1;

export interface ComputerResources {
  cpus: string;
  memory: string;
  pidsLimit: number;
}

export const DEFAULT_COMPUTER_RESOURCES: ComputerResources = { cpus: '2', memory: '2g', pidsLimit: 512 };
export const EGRESS_RESOURCES: ComputerResources = { cpus: '0.5', memory: '128m', pidsLimit: 64 };

const BOT_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const LOG_ARGS = ['--log-driver', 'json-file', '--log-opt', 'max-size=10m', '--log-opt', 'max-file=3'];

export function assertBotId(botId: string): string {
  if (!BOT_ID.test(botId)) throw new Error('bot id cannot be used as a container name');
  return botId;
}

export const computerName = (botId: string): string => `brot-computer-${botId}`;
export const egressName = (botId: string): string => `brot-egress-${botId}`;
export const networkName = (botId: string): string => `brot-net-${botId}`;
export const workspaceVolumeName = (botId: string): string => `brot-workspace-${botId}`;

/** A stable digest of the inputs that shape a container. A mismatch means the container is recreated. */
export function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** Environment for the computer. Every proxy variable points at the sidecar, and the Brot endpoint is exempt. */
export function computerEnv(): Record<string, string> {
  const proxy = `http://${EGRESS_ALIAS}:${EGRESS_PORT}`;
  const noProxy = [EGRESS_ALIAS, 'localhost', '127.0.0.1', '::1'].join(',');
  return {
    HTTPS_PROXY: proxy,
    HTTP_PROXY: proxy,
    ALL_PROXY: proxy,
    https_proxy: proxy,
    http_proxy: proxy,
    all_proxy: proxy,
    NO_PROXY: noProxy,
    no_proxy: noProxy,
    // Makes Node's built-in fetch and http clients (the DeepSeek Harness among them) honour the proxy variables.
    NODE_USE_ENV_PROXY: '1',
    HOME: HOME_PATH,
  };
}

function labelArgs(botId: string, role: string, labelFingerprint?: string): string[] {
  const labels = ['brot.managed=true', `brot.bot=${botId}`, `brot.role=${role}`];
  if (labelFingerprint !== undefined) labels.push(`${FINGERPRINT_LABEL}=${labelFingerprint}`);
  return labels.flatMap((label) => ['--label', label]);
}

export function buildVolumeCreateArgs(botId: string): string[] {
  return ['volume', 'create', ...labelArgs(assertBotId(botId), 'volume'), workspaceVolumeName(botId)];
}

/** `--internal` gives the network no gateway and no masquerading, so nothing on it reaches the outside. */
export function buildNetworkCreateArgs(botId: string): string[] {
  return ['network', 'create', '--internal', '--driver', 'bridge', ...labelArgs(assertBotId(botId), 'network'), networkName(botId)];
}

export function buildNetworkConnectArgs(network: string, container: string): string[] {
  return ['network', 'connect', '--alias', EGRESS_ALIAS, network, container];
}

export function buildEgressRunArgs(input: {
  botId: string;
  image: string;
  config: SidecarConfig;
  fingerprint: string;
}): string[] {
  const botId = assertBotId(input.botId);
  return [
    'run',
    '-d',
    '--name',
    egressName(botId),
    ...labelArgs(botId, 'egress', input.fingerprint),
    '--network',
    'bridge',
    '--add-host',
    `${HOST_ALIAS}:host-gateway`,
    '--user',
    COMPUTER_USER,
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '--pids-limit',
    String(EGRESS_RESOURCES.pidsLimit),
    '--memory',
    EGRESS_RESOURCES.memory,
    '--memory-swap',
    EGRESS_RESOURCES.memory,
    '--cpus',
    EGRESS_RESOURCES.cpus,
    '--init',
    '--restart',
    'no',
    ...LOG_ARGS,
    '-e',
    `BROT_EGRESS_CONFIG=${JSON.stringify(input.config)}`,
    input.image,
  ];
}

export function buildComputerRunArgs(input: {
  botId: string;
  image: string;
  network: string;
  resources: ComputerResources;
  fingerprint: string;
  desktop?: boolean;
}): string[] {
  const botId = assertBotId(input.botId);
  const { resources } = input;
  const env = Object.entries(computerEnv()).flatMap(([key, value]) => ['-e', `${key}=${value}`]);
  return [
    'run',
    '-d',
    '--name',
    computerName(botId),
    ...labelArgs(botId, 'computer', input.fingerprint),
    '--network',
    input.network,
    '--user',
    COMPUTER_USER,
    '--read-only',
    // Docker mounts tmpfs noexec by default. DSH's native addon loader (0.2.1-rc.2) copies its .node
    // bindings into /tmp and dlopens them there, so /tmp must allow exec. The agent already has a shell,
    // so noexec here was not a boundary; containment is the network, dropped caps and the read-only root.
    '--tmpfs',
    '/tmp:rw,exec,nosuid,nodev,size=512m,mode=1777',
    '--tmpfs',
    `${HOME_PATH}:rw,nosuid,nodev,size=512m,uid=${COMPUTER_UID},gid=${COMPUTER_UID},mode=0700`,
    '--mount',
    `type=volume,source=${workspaceVolumeName(botId)},target=${WORKSPACE_PATH}`,
    '--workdir',
    WORKSPACE_PATH,
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '--pids-limit',
    String(resources.pidsLimit),
    '--memory',
    resources.memory,
    '--memory-swap',
    resources.memory,
    '--cpus',
    resources.cpus,
    '--init',
    '--restart',
    'no',
    ...LOG_ARGS,
    ...env,
    input.image,
    ...(input.desktop === true ? DESKTOP_COMMAND : ['sleep', 'infinity']),
  ];
}

export function buildExecArgs(
  container: string,
  cmd: readonly string[],
  opts: { env?: Record<string, string>; cwd?: string } = {},
): string[] {
  if (cmd.length === 0 || cmd.some((arg) => arg.includes('\0'))) {
    throw new Error('command must be a non-empty list of strings');
  }
  const args = ['exec', '-i'];
  if (opts.cwd !== undefined) {
    if (!opts.cwd.startsWith('/') || opts.cwd.includes('\0')) throw new Error('cwd must be an absolute path');
    args.push('--workdir', opts.cwd);
  }
  for (const [key, value] of Object.entries(opts.env ?? {})) {
    if (!ENV_KEY.test(key) || value.includes('\0')) throw new Error('invalid environment variable');
    args.push('--env', `${key}=${value}`);
  }
  args.push(container, ...cmd);
  return args;
}

export const buildStartArgs = (name: string): string[] => ['start', name];
export const buildStopArgs = (name: string): string[] => ['stop', '--time', '5', name];
export const buildRemoveArgs = (name: string): string[] => ['rm', '--force', name];
export const buildLogsArgs = (name: string): string[] => ['logs', '--follow', '--tail', '0', name];
export const buildImageInspectArgs = (image: string): string[] => ['image', 'inspect', '--format', '{{.Id}}', image];
export const buildVersionArgs = (): string[] => ['version', '--format', '{{.Server.Version}}'];
export const buildInspectArgs = (kind: 'container' | 'network', name: string): string[] => [
  'inspect',
  '--type',
  kind,
  '--format',
  '{{json .}}',
  name,
];

/**
 * Reads one line of the sidecar's log. A line is a refused host when it is a JSON object with `brot: "blocked"`
 * and a host that fits the `network.blocked` event. Anything else is ignored.
 */
export function parseBlockedLine(line: string): string | undefined {
  if (!line.startsWith('{')) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (record.brot !== 'blocked' || typeof record.host !== 'string') return undefined;
  const host = record.host;
  return host.length > 0 && host.length <= 253 && !/[\s/?#@]/.test(host) ? host : undefined;
}

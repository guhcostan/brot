import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  assertBotId,
  buildComputerRunArgs,
  buildEgressRunArgs,
  buildExecArgs,
  buildNetworkConnectArgs,
  buildNetworkCreateArgs,
  computerEnv,
  DEFAULT_COMPUTER_RESOURCES,
  fingerprint,
  parseBlockedLine,
} from './docker-args';
import type { SidecarConfig } from './egress-proxy';

const BOT = 'bot_01';
const CONFIG: SidecarConfig = {
  allow: ['api.example.com', '*.example.org'],
  internal: { host: 'host.docker.internal', port: 8799 },
  subnet: '172.28.0.0/16',
  proxyPort: 3128,
};

/** Returns the value that follows `flag`, or undefined. Asserts the pair appears together. */
function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function hasPair(args: string[], flag: string, value: string): boolean {
  return args.some((arg, index) => arg === flag && args[index + 1] === value);
}

const computerArgs = (): string[] =>
  buildComputerRunArgs({
    botId: BOT,
    image: 'brot-computer:latest',
    network: 'brot-net-bot_01',
    resources: DEFAULT_COMPUTER_RESOURCES,
    fingerprint: 'abc',
  });

describe('computer container arguments', () => {
  it('applies the hardening flags', () => {
    const args = computerArgs();
    expect(hasPair(args, '--cap-drop', 'ALL')).toBe(true);
    expect(hasPair(args, '--security-opt', 'no-new-privileges:true')).toBe(true);
    expect(args).toContain('--read-only');
    expect(hasPair(args, '--user', '1000:1000')).toBe(true);
    expect(hasPair(args, '--pids-limit', '512')).toBe(true);
    expect(hasPair(args, '--memory', '2g')).toBe(true);
    expect(hasPair(args, '--memory-swap', '2g')).toBe(true);
    expect(hasPair(args, '--cpus', '2')).toBe(true);
  });

  it('never grants privilege, host namespaces, extra capabilities or host paths', () => {
    const args = computerArgs();
    for (const forbidden of ['--privileged', '--cap-add', '-v', '--volume', '-p', '--publish', '-P', '--pid', '--ipc', '--uts']) {
      expect(args).not.toContain(forbidden);
    }
    expect(args.some((arg) => arg.includes('docker.sock'))).toBe(false);
    expect(args.some((arg) => arg.includes('type=bind'))).toBe(false);
    expect(args.some((arg) => arg === 'host')).toBe(false);
  });

  it('joins only the bot internal network, never the bridge or host network', () => {
    const args = computerArgs();
    expect(valueAfter(args, '--network')).toBe('brot-net-bot_01');
    expect(args).not.toContain('bridge');
    expect(args).not.toContain('--add-host');
  });

  it('mounts only the bot workspace volume, a named volume and no host path', () => {
    const args = computerArgs();
    expect(hasPair(args, '--mount', 'type=volume,source=brot-workspace-bot_01,target=/workspace')).toBe(true);
    expect(hasPair(args, '--workdir', '/workspace')).toBe(true);
  });

  it('names the container per bot, labels it and runs sleep as its command', () => {
    const args = computerArgs();
    expect(valueAfter(args, '--name')).toBe('brot-computer-bot_01');
    expect(args).toContain('brot.managed=true');
    expect(args).toContain('brot.bot=bot_01');
    expect(args).toContain('brot.role=computer');
    expect(args).toContain('brot.fingerprint=abc');
    expect(args.slice(-3)).toEqual(['brot-computer:latest', 'sleep', 'infinity']);
  });

  it('points every proxy variable at the sidecar and exempts only the internal names from it', () => {
    const env = computerEnv();
    for (const key of ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'https_proxy', 'http_proxy', 'all_proxy']) {
      expect(env[key]).toBe('http://brot-egress:3128');
    }
    expect(env.NO_PROXY).toBe('brot-egress,localhost,127.0.0.1,::1');
    expect(env.NODE_USE_ENV_PROXY).toBe('1');
    expect(computerArgs()).toContain('HTTPS_PROXY=http://brot-egress:3128');
  });

  it('caps the log size so a chatty computer cannot fill the disk', () => {
    expect(hasPair(computerArgs(), '--log-opt', 'max-size=10m')).toBe(true);
  });
});

describe('internal network and sidecar arguments', () => {
  it('creates the bot network as internal, so it has no route out', () => {
    const args = buildNetworkCreateArgs(BOT);
    expect(args).toContain('--internal');
    expect(args.slice(0, 2)).toEqual(['network', 'create']);
    expect(args.at(-1)).toBe('brot-net-bot_01');
  });

  it('runs the sidecar on the bridge with the host alias and the same hardening', () => {
    const args = buildEgressRunArgs({ botId: BOT, image: 'brot-egress:latest', config: CONFIG, fingerprint: 'def' });
    expect(valueAfter(args, '--network')).toBe('bridge');
    expect(hasPair(args, '--add-host', 'host.docker.internal:host-gateway')).toBe(true);
    expect(hasPair(args, '--cap-drop', 'ALL')).toBe(true);
    expect(hasPair(args, '--security-opt', 'no-new-privileges:true')).toBe(true);
    expect(args).toContain('--read-only');
    expect(args).not.toContain('--privileged');
    expect(args).not.toContain('-p');
    expect(args.some((arg) => arg.includes('docker.sock'))).toBe(false);
    expect(args.at(-1)).toBe('brot-egress:latest');
  });

  it('passes the allowlist and the internal endpoint to the sidecar as JSON', () => {
    const args = buildEgressRunArgs({ botId: BOT, image: 'brot-egress:latest', config: CONFIG, fingerprint: 'def' });
    const env = args[args.indexOf('-e') + 1] ?? '';
    expect(env.startsWith('BROT_EGRESS_CONFIG=')).toBe(true);
    expect(JSON.parse(env.slice('BROT_EGRESS_CONFIG='.length))).toEqual(CONFIG);
  });

  it('connects the sidecar to the internal network under the egress alias', () => {
    expect(buildNetworkConnectArgs('brot-net-bot_01', 'brot-egress-bot_01')).toEqual([
      'network',
      'connect',
      '--alias',
      'brot-egress',
      'brot-net-bot_01',
      'brot-egress-bot_01',
    ]);
  });
});

describe('exec arguments', () => {
  it('passes the command as separate argv entries, never through a shell', () => {
    const hostile = ['sh', '-c', 'echo $HOME; rm -rf /'];
    const args = buildExecArgs('brot-computer-bot_01', hostile);
    expect(args.slice(-hostile.length)).toEqual(hostile);
    expect(args.slice(0, 2)).toEqual(['exec', '-i']);
    expect(args.indexOf('brot-computer-bot_01')).toBeLessThan(args.indexOf('sh'));
  });

  it('adds the working directory and environment as flags', () => {
    const args = buildExecArgs('c', ['node', 'x.js'], { cwd: '/workspace', env: { BROT_EXEC_ID: 'id-1' } });
    expect(hasPair(args, '--workdir', '/workspace')).toBe(true);
    expect(hasPair(args, '--env', 'BROT_EXEC_ID=id-1')).toBe(true);
  });

  it('refuses an empty command, a relative cwd, and malformed environment names', () => {
    expect(() => buildExecArgs('c', [])).toThrow();
    expect(() => buildExecArgs('c', ['x\0y'])).toThrow();
    expect(() => buildExecArgs('c', ['ls'], { cwd: 'workspace' })).toThrow();
    expect(() => buildExecArgs('c', ['ls'], { env: { 'BAD KEY': 'v' } })).toThrow();
  });
});

describe('bot ids and fingerprints', () => {
  it.each(['../etc', '', ' spaced', 'a/b', '-leading', 'x'.repeat(65)])('rejects %j as a container name part', (id) => {
    expect(() => assertBotId(id)).toThrow();
  });

  it('accepts a generated id', () => {
    expect(assertBotId('01J9Z4K7W2M3N5P6Q7R8S9T0UV')).toBe('01J9Z4K7W2M3N5P6Q7R8S9T0UV');
  });

  it('changes the fingerprint when the allowlist changes', () => {
    const a = fingerprint({ allow: ['a.example.com'] });
    const b = fingerprint({ allow: ['a.example.com', 'b.example.com'] });
    expect(a).not.toBe(b);
    expect(fingerprint({ allow: ['a.example.com'] })).toBe(a);
  });
});

describe('blocked-host log lines', () => {
  it('reads a refused host from a sidecar line', () => {
    expect(parseBlockedLine('{"brot":"blocked","host":"evil.example"}')).toBe('evil.example');
  });

  it.each([
    ['not JSON', 'egress sidecar ready'],
    ['another tag', '{"brot":"other","host":"x.example"}'],
    ['a non-string host', '{"brot":"blocked","host":42}'],
    ['a host with a path', '{"brot":"blocked","host":"x.example/path"}'],
    ['an empty host', '{"brot":"blocked","host":""}'],
    ['an invalid JSON object', '{"brot":"blocked"'],
  ])('ignores %s', (_label, line) => {
    expect(parseBlockedLine(line)).toBeUndefined();
  });
});

describe('the computer image', () => {
  const dockerfile = (name: string): string =>
    readFileSync(fileURLToPath(new URL(`../../../../images/computer/${name}`, import.meta.url)), 'utf8');

  it('pins the DeepSeek Harness to the version packages/engines pins', () => {
    const engines = JSON.parse(
      readFileSync(fileURLToPath(new URL('../../../../packages/engines/package.json', import.meta.url)), 'utf8'),
    ) as { dependencies: Record<string, string> };
    const pinned = engines.dependencies['@deepseek-ai/dsh'];
    expect(pinned).toBeDefined();
    expect(dockerfile('Dockerfile')).toContain(`ARG DSH_VERSION=${pinned}`);
    expect(dockerfile('Dockerfile')).toContain('"@deepseek-ai/dsh@${DSH_VERSION}"');
  });

  it('runs as a non-root user, bakes in no secrets and declares the workspace volume', () => {
    const text = dockerfile('Dockerfile');
    expect(text).toContain('USER node');
    expect(text).toContain('VOLUME ["/workspace"]');
    expect(text).not.toMatch(/^(ENV|ARG)\s+\S*(TOKEN|SECRET|KEY|PASSWORD)/im);
  });

  it('builds the sidecar from the proxy source with no install step', () => {
    const text = dockerfile('egress.Dockerfile');
    expect(text).toContain('COPY egress-proxy.ts /opt/brot/egress-proxy.mts');
    expect(text).toContain('USER node');
  });
});

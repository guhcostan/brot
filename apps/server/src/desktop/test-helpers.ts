import type { Bot, ComputerHandle } from '@brot/protocol';
import type { ComputerProvider } from '../computers/types';
import type { DesktopCommandResult, DesktopRunner } from './service';

/** The smallest valid JPEG header followed by filler. Only the first bytes matter to the service. */
export const FAKE_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);

export interface RecordedCommand {
  botId: string;
  argv: string[];
  env: Record<string, string> | undefined;
}

export interface FakeRunner extends DesktopRunner {
  calls: RecordedCommand[];
  /** Answers `brot-browser <command>` with this JSON object. Defaults to a page at about:blank. */
  browserReply: Record<string, unknown> | ((command: string, args: Record<string, unknown>) => Record<string, unknown>);
  /** Makes every command fail with this stderr when set. */
  failWith?: string;
}

const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));

function reply(code: number, stdout: Uint8Array, stderr = ''): DesktopCommandResult {
  return { code, stdout, stderr };
}

/**
 * Stands in for `docker exec` in tests. It answers each argv the way the real desktop does, and records every call
 * so tests can assert the exact argv and env that would have run.
 */
export function fakeRunner(): FakeRunner {
  const runner: FakeRunner = {
    calls: [],
    browserReply: { url: 'about:blank', title: '' },
    async run(bot: Bot, argv: string[], env?: Record<string, string>) {
      runner.calls.push({ botId: bot.id, argv, env });
      if (runner.failWith !== undefined) return reply(1, new Uint8Array(), runner.failWith);
      if (argv[0] === 'import') return reply(0, FAKE_JPEG);
      if (argv[0] === 'brot-browser') {
        const command = argv[1] ?? '';
        const args = JSON.parse(argv[2] ?? '{}') as Record<string, unknown>;
        const body = typeof runner.browserReply === 'function' ? runner.browserReply(command, args) : runner.browserReply;
        return reply(0, encode(body));
      }
      return reply(0, new Uint8Array());
    },
  };
  return runner;
}

/** A provider that starts at once. Commands go through the runner, so the handle's own exec is never used. */
export function fakeProvider(): ComputerProvider {
  const handle: ComputerHandle = {
    id: 'brot-computer-fake',
    exec: () => Promise.reject(new Error('exec is not used in desktop tests')),
  };
  return {
    id: 'docker',
    available: async () => ({ ok: true }),
    ensure: async () => handle,
    internalEndpoint: () => ({ url: 'http://brot-egress:8799' }),
    stop: async () => undefined,
    close: async () => undefined,
  };
}

import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { DEFAULT_SERVER_PORT, type EngineDriver } from '@brot/protocol';
import type { ServerHandle, StartOptions } from '@brot/server';
import { BrotClient, type FetchLike } from './client';
import { runDoctor } from './commands/doctor';
import { runBot } from './commands/run';
import { runServe } from './commands/serve';
import type { Writer } from './io';

export const DEFAULT_URL = `http://127.0.0.1:${DEFAULT_SERVER_PORT}`;

const USAGE = `Usage: brot <command> [options]

Commands:
  serve [--host <host>] [--port <port>]   Run the Brot server in this process
  doctor                                  Check Node, BROT_HOME, engines, and the server
  run <botId> <message...>                Send a message to a bot and stream its reply

Options:
  --url <url>   Server to talk to (default ${DEFAULT_URL})
  --json        One JSON object per line instead of text
  -h, --help    Show this help

Exit codes: 0 success, 1 a check or run failed, 2 usage error, 130 interrupted.
`;

export interface CliDeps {
  env: Record<string, string | undefined>;
  stdout: Writer;
  stderr: Writer;
  fetch: FetchLike;
  signal: AbortSignal;
  start: (options: StartOptions) => Promise<ServerHandle>;
  engines: EngineDriver[];
  nodeVersion: string;
}

class UsageError extends Error {}

/** Runs one CLI invocation and returns its exit code. Output goes only through the injected writers. */
export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
  try {
    const { values, positionals } = parseFlags(argv);
    if (values.help) {
      deps.stdout.write(USAGE);
      return 0;
    }
    const [command, ...rest] = positionals;
    if (command === undefined) {
      deps.stderr.write(USAGE);
      return 2;
    }
    const json = values.json === true;

    switch (command) {
      case 'serve':
        noArguments(command, rest);
        return await runServe(
          { host: values.host, port: parsePort(values.port) },
          { start: deps.start, stdout: deps.stdout, signal: deps.signal },
        );
      case 'doctor':
        noArguments(command, rest);
        return await runDoctor({
          home: resolveHome(deps.env),
          nodeVersion: deps.nodeVersion,
          engines: deps.engines,
          client: clientFor(values.url, deps.fetch),
          stdout: deps.stdout,
          json,
        });
      case 'run': {
        const [botId, ...words] = rest;
        if (botId === undefined || words.length === 0) {
          throw new UsageError('run needs a bot id and a message: brot run <botId> <message>');
        }
        return await runBot(
          { botId, message: words.join(' '), json, signal: deps.signal },
          { client: clientFor(values.url, deps.fetch), stdout: deps.stdout, stderr: deps.stderr },
        );
      }
      default:
        throw new UsageError(`unknown command "${command}"`);
    }
  } catch (error) {
    if (error instanceof UsageError) {
      deps.stderr.write(`brot: ${error.message}\nRun "brot --help" for usage.\n`);
      return 2;
    }
    deps.stderr.write(`brot: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

function parseFlags(argv: string[]) {
  try {
    return parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        json: { type: 'boolean' },
        url: { type: 'string' },
        host: { type: 'string' },
        port: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
}

function noArguments(command: string, rest: string[]): void {
  if (rest.length > 0) throw new UsageError(`${command} takes no arguments`);
}

function parsePort(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new UsageError(`--port must be a port between 0 and 65535, got "${value}"`);
  }
  return port;
}

function clientFor(url: string | undefined, fetchImpl: FetchLike): BrotClient {
  const base = url ?? DEFAULT_URL;
  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    throw new UsageError(`--url is not a valid URL: ${base}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new UsageError(`--url must start with http:// or https://, got ${base}`);
  }
  return new BrotClient(base, fetchImpl);
}

/** Same rule the server uses: BROT_HOME when set, otherwise ~/.brot. */
function resolveHome(env: Record<string, string | undefined>): string {
  return resolve(env.BROT_HOME ?? join(homedir(), '.brot'));
}

import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * `desktop` runs in the Electron shell on the user's machine, where `computer: 'host'` is allowed.
 * `server` is self-hosted or cloud, where only sandboxed and no-computer bots may run.
 */
export type ServerMode = 'desktop' | 'server';

export interface ServerConfig {
  home: string;
  host: string;
  port: number;
  webhookPort: number;
  dbUrl: string;
  mode: ServerMode;
  /** Image a `computer: 'sandbox'` bot runs in. */
  computerImage: string;
  /** Extra and overriding model providers, read at start. Holds secret names only, never keys. */
  providersFile: string;
}

export interface ConfigOverrides {
  home?: string;
  host?: string;
  port?: number;
  webhookPort?: number;
  mode?: ServerMode;
  computerImage?: string;
}

const DEFAULT_COMPUTER_IMAGE = 'brot-computer:latest';

function readMode(value: string | undefined): ServerMode {
  if (value === undefined || value === '') return 'server';
  if (value === 'desktop' || value === 'server') return value;
  throw new Error(`BROT_MODE must be "desktop" or "server", got "${value}"`);
}

function readPort(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`${name} must be a port between 0 and 65535, got "${value}"`);
  }
  return port;
}

/**
 * Resolves server settings from the environment and creates the home directory.
 * Explicit overrides take precedence over environment variables.
 */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
  overrides: ConfigOverrides = {},
): ServerConfig {
  const home = resolve(overrides.home ?? env.BROT_HOME ?? join(homedir(), '.brot'));
  mkdirSync(home, { recursive: true, mode: 0o700 });
  return {
    home,
    host: overrides.host ?? env.BROT_HOST ?? '127.0.0.1',
    port: overrides.port ?? readPort('BROT_PORT', env.BROT_PORT, 8799),
    webhookPort: overrides.webhookPort ?? readPort('BROT_WEBHOOK_PORT', env.BROT_WEBHOOK_PORT, 8800),
    dbUrl: `file:${join(home, 'brot.db')}`,
    mode: overrides.mode ?? readMode(env.BROT_MODE),
    computerImage: overrides.computerImage ?? env.BROT_COMPUTER_IMAGE ?? DEFAULT_COMPUTER_IMAGE,
    providersFile: join(home, 'providers.json'),
  };
}

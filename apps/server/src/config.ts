import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export interface ServerConfig {
  home: string;
  host: string;
  port: number;
  webhookPort: number;
  dbUrl: string;
}

export interface ConfigOverrides {
  home?: string;
  host?: string;
  port?: number;
  webhookPort?: number;
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
  };
}

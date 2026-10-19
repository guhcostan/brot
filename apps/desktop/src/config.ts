import { DEFAULT_SERVER_PORT, DEFAULT_WEB_PORT, DEFAULT_WEBHOOK_PORT } from '@brot/protocol';
import { join } from 'node:path';

/** Fixed so the web origin, and therefore its localStorage, survives restarts. */
export const DEFAULT_GATEWAY_PORT = 8798;

export type DesktopConfig = {
  devServer: boolean;
  home: string;
  server: { port: number; webhookPort: number };
  web: { kind: 'url'; url: string } | { kind: 'gateway'; root: string; port: number };
};

export interface ResolveConfigInput {
  /** True for `electron . --dev`, where the Vite dev server at 5199 serves the UI and proxies /api to 8799. */
  devServer: boolean;
  env: Record<string, string | undefined>;
  userDataDir: string;
  isPackaged: boolean;
  resourcesPath: string;
  /** Directory holding the bundled main.cjs. */
  bundleDir: string;
}

export function resolveDesktopConfig(input: ResolveConfigInput): DesktopConfig {
  const home = input.env.BROT_HOME || input.userDataDir;

  if (input.devServer) {
    return {
      devServer: true,
      home,
      server: { port: DEFAULT_SERVER_PORT, webhookPort: DEFAULT_WEBHOOK_PORT },
      web: { kind: 'url', url: `http://127.0.0.1:${DEFAULT_WEB_PORT}` },
    };
  }

  const root = input.isPackaged
    ? join(input.resourcesPath, 'web')
    : join(input.bundleDir, '..', '..', 'web', 'dist');

  return {
    devServer: false,
    home,
    server: { port: 0, webhookPort: 0 },
    web: { kind: 'gateway', root, port: readPort(input.env.BROT_DESKTOP_PORT, DEFAULT_GATEWAY_PORT) },
  };
}

function readPort(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`BROT_DESKTOP_PORT must be a port between 1 and 65535, got "${value}"`);
  }
  return port;
}

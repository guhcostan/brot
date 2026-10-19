import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEngineRegistry, createMockEngine, type EngineRegistry } from '@brot/engines';
import type { CanonicalEvent } from '@brot/protocol';
import { createApp } from './app';
import { loadConfig, type ServerMode } from './config';
import type { ComputerProvider } from './computers/types';
import type { ComputerProviders } from './harness';
import { createServices, type ServiceExtras, type Services } from './services';
import { createWebhookApp } from './webhooks';

type AppLike = { request(input: string, init?: RequestInit): Response | Promise<Response> };

export interface TestContext {
  dir: string;
  services: Services;
  /** Loopback caller, i.e. the local user. */
  app: ReturnType<typeof createApp>;
  /** A remote caller: loopback is not trusted, so every request needs a device token. */
  remote: ReturnType<typeof createApp>;
  webhooks: ReturnType<typeof createWebhookApp>;
  close(): Promise<void>;
}

export interface TestContextOptions {
  engines?: EngineRegistry;
  /** Default: a ready `sandbox` provider, because bots default to `computer: 'sandbox'`. Pass `{}` for none. */
  computers?: ServiceExtras['computers'];
  mcp?: ServiceExtras['mcp'];
  team?: ServiceExtras['team'];
  mode?: ServerMode;
}

/** A provider that starts at once and runs no commands. Stands in for Docker in tests that do not inspect the computer. */
export function readyComputerProvider(id: ComputerProvider['id'] = 'docker'): ComputerProvider {
  return {
    id,
    available: async () => ({ ok: true }),
    ensure: async () => ({
      id: `${id}-test-computer`,
      exec: () => Promise.reject(new Error('exec is not available in tests')),
    }),
    internalEndpoint: () => ({ url: 'http://host.docker.internal:8799' }),
    stop: async () => undefined,
    close: async () => undefined,
  };
}

function defaultComputers(): ComputerProviders {
  return { sandbox: readyComputerProvider('docker') };
}

/** Builds services on a fresh temporary BROT_HOME. Uses only the mock engine unless another registry is given. */
export async function createTestContext(options: TestContextOptions = {}): Promise<TestContext> {
  const dir = await mkdtemp(join(tmpdir(), 'brot-server-'));
  const config = loadConfig({ BROT_HOME: dir, BROT_MODE: options.mode ?? 'server' });
  const services = await createServices(config, options.engines ?? createEngineRegistry([createMockEngine()]), {
    computers: options.computers ?? defaultComputers(),
    mcp: options.mcp,
    team: options.team,
  });
  const deps = { ...services, config: { host: config.host, port: config.port, mode: config.mode } };
  return {
    dir,
    services,
    app: createApp({ ...deps, trustLoopback: true }),
    remote: createApp({ ...deps, trustLoopback: false }),
    webhooks: createWebhookApp(services),
    async close() {
      await services.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/** Sends a request the way the web client does: writes always declare application/json. */
export function call(
  app: AppLike,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  const writes = method === 'POST' || method === 'PUT' || method === 'PATCH';
  return Promise.resolve(
    app.request(path, {
      method,
      headers: writes ? { 'content-type': 'application/json', ...headers } : headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

/** Collects events from the bus as they are published, optionally for one thread. */
export function recordEvents(bus: Services['bus'], threadId?: string): { list: CanonicalEvent[]; stop(): void } {
  const list: CanonicalEvent[] = [];
  const unsubscribe = bus.subscribe((event) => list.push(event), { threadId });
  return { list, stop: unsubscribe };
}

export async function waitUntil<T>(read: () => T | undefined, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

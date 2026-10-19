import { type ServerType, serve } from '@hono/node-server';
import { createEngineRegistry, defaultEngines, type EngineRegistry } from '@brot/engines';
import type { Repos } from '@brot/db';
import type { Server } from 'node:http';
import type { Hono } from 'hono';
import { createApp } from './app';
import type { AppEnv, Bindings } from './auth';
import { loadConfig, type ConfigOverrides } from './config';
import { createServices } from './services';
import { createWebhookApp } from './webhooks';
export { createApp } from './app';
export { createServices, type Services } from './services';
export { createWebhookApp } from './webhooks';

export interface StartOptions extends ConfigOverrides {
  engines?: EngineRegistry;
}

export interface ServerHandle {
  host: string;
  port: number;
  webhookPort: number;
  app: Hono<AppEnv>;
  close(): Promise<void>;
}

/** Starts the API and the webhook receiver. Pass port 0 to let the OS choose a free port. */
export async function startServer(options: StartOptions = {}): Promise<ServerHandle> {
  const { engines: engineOverride, ...overrides } = options;
  const config = loadConfig(process.env, overrides);
  const services = await createServices(config, engineOverride ?? createEngineRegistry(defaultEngines()));

  await seedFirstBot(services.repos);
  const recovered = await services.harness.recoverInterruptedRuns();
  if (recovered > 0) console.warn(`marked ${recovered} interrupted run(s) as failed`);
  await services.scheduler.sync();

  const app = createApp({ ...services, trustLoopback: true });
  const webhooks = createWebhookApp(services);
  const api = await listen((request, env) => app.fetch(request, env), config.host, config.port);
  let hooks: { server: ServerType; port: number };
  try {
    hooks = await listen((request, env) => webhooks.fetch(request, env), config.host, config.webhookPort);
  } catch (error) {
    await closeServer(api.server);
    await services.close();
    throw error;
  }

  return {
    host: config.host,
    port: api.port,
    webhookPort: hooks.port,
    app,
    async close() {
      await Promise.all([closeServer(api.server), closeServer(hooks.server)]);
      await services.close();
    },
  };
}

async function seedFirstBot(repos: Repos): Promise<void> {
  if ((await repos.bots.list({ includeArchived: true })).length > 0) return;
  await repos.bots.create({
    name: 'Capy',
    job: 'Chief of Staff',
    engine: 'mock',
    instructions: 'You are Capy, a calm and capable chief of staff.',
  });
}

type Fetch = (request: Request, env: Bindings) => Response | Promise<Response>;

function listen(fetch: Fetch, host: string, port: number): Promise<{ server: ServerType; port: number }> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: (request, env) => fetch(request, env as Bindings), hostname: host, port }, (info) => {
      resolve({ server, port: info.port });
    });
    server.once('error', reject);
  });
}

function closeServer(server: ServerType): Promise<void> {
  return new Promise((resolve, reject) => {
    (server as Server).close((error) => (error ? reject(error) : resolve()));
    (server as Server).closeAllConnections();
  });
}

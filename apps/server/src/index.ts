import { type ServerType, serve } from '@hono/node-server';
import { createEngineRegistry, defaultEngines, type EngineRegistry } from '@brot/engines';
import type { Repos } from '@brot/db';
import type { Server } from 'node:http';
import type { Hono } from 'hono';
import { createApp } from './app';
import { createDockerComputerProvider, createHostComputerProvider } from './computers';
import { createBrotMcp } from './mcp';
import { createTeamTools } from './team';
import type { AppEnv, Bindings } from './auth';
import { loadConfig, type ConfigOverrides } from './config';
import { createServices, type ServiceExtras } from './services';
import { createWebhookApp } from './webhooks';
export { createApp } from './app';
export { createServices, type ServiceExtras, type Services } from './services';
export { createWebhookApp } from './webhooks';

export interface StartOptions extends ConfigOverrides {
  engines?: EngineRegistry;
  /** Sandbox and host computer providers. Absent: `computer: 'sandbox'` runs fail, `host` is not offered. */
  computers?: ServiceExtras['computers'];
  /** Builds the Brot MCP server for contained runs from the server's own services. Absent: no Brot MCP tools. */
  mcp?: ServiceExtras['mcp'];
  /** Team tools for bots in rooms and tasks, registered on the Brot MCP server. Absent: the built-in team tools. */
  team?: ServiceExtras['team'];
  /** Model relay options: extra providers and the outbound HTTP. Absent: seeded providers and `providers.json`. */
  llm?: ServiceExtras['llm'];
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
  const { engines: engineOverride, computers, mcp, team, llm, ...overrides } = options;
  const config = loadConfig(process.env, overrides);
  const services = await createServices(config, engineOverride ?? createEngineRegistry(defaultEngines()), {
    computers: computers ?? {
      sandbox: createDockerComputerProvider({ computerImage: config.computerImage, brotPort: config.port }),
      ...(config.mode === 'desktop'
        ? { host: createHostComputerProvider({ brotHome: config.home, brotPort: config.port }) }
        : {}),
    },
    mcp: mcp ?? createBrotMcp,
    team: team ?? createTeamTools,
    llm,
  });

  await seedFirstBot(services.repos);
  const recovered = await services.harness.recoverInterruptedRuns();
  if (recovered > 0) console.warn(`marked ${recovered} interrupted run(s) as failed`);
  await services.scheduler.sync();

  const app = createApp({ ...services, trustLoopback: true });
  const webhooks = createWebhookApp(services);
  const api = await listen((request, env) => app.fetch(request, env), config.host, config.port);
  // Port 0 lets the OS pick; loopback MCP URLs must name the port that was bound.
  config.port = api.port;
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
    // The mock engine runs no tools, so the seeded bot needs no computer until a real engine is chosen.
    computer: 'none',
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

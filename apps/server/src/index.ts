import { type ServerType, serve } from '@hono/node-server';
import { createEngineRegistry, defaultEngines, type EngineRegistry } from '@brot/engines';
import type { Repos } from '@brot/db';
import { homedir } from 'node:os';
import type { Server } from 'node:http';
import { join, resolve as resolvePath } from 'node:path';
import type { Hono } from 'hono';
import { createApp } from './app';
import {
  createDockerComputerProvider,
  createHostComputerProvider,
  sweepOrphanedSandboxContainers,
  type OrphanSweepOptions,
} from './computers';
import { createBrotMcp } from './mcp';
import { createTeamTools } from './team';
import type { AppEnv, Bindings } from './auth';
import { loadConfig, type ConfigOverrides } from './config';
import { createBackupScheduler } from './backup';
import { expireOrphanedApprovals } from './harness';
import { recordActivity } from './activity/record';
import { createServices, type ServiceExtras, type Services } from './services';
import { createWebhookApp } from './webhooks';
export { createApp } from './app';
export { createServices, type ServiceExtras, type Services } from './services';
export { createWebhookApp } from './webhooks';
export * from './backup';

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
  /**
   * Reclaim `brot-computer-*` / `brot-egress-*` containers whose bot is gone or no longer uses a sandbox.
   * Defaults to on only for the canonical `~/.brot` home, because containers are machine-global and a test or
   * custom home shares the daemon with the real installation. Pass `{ exec }` in tests, `false` to opt out.
   */
  orphanSweep?: false | OrphanSweepOptions;
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
  const { engines: engineOverride, computers, mcp, team, llm, orphanSweep, ...overrides } = options;
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
  await expireOrphanedApprovals({
    approvals: services.repos.approvals,
    runs: services.repos.runs,
    bus: services.bus,
  });
  await services.scheduler.sync();
  await sweepOrphanedAttachments(services);
  const sweep = orphanSweep ?? (isCanonicalHome(config.home) ? {} : false);
  if (sweep !== false) {
    // Housekeeping only: a docker problem or a slow container must never delay the API from listening.
    void sweepOrphanedSandboxContainers({ repos: services.repos, ...sweep }).catch(() => undefined);
  }

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
  // GET /api/webhooks reports the receiver's actual port, which matters when webhookPort was 0.
  config.webhookPort = hooks.port;

  // Scheduled backups: a 15-minute check while Brot runs. The timer is unref'd and every failure is contained.
  const backupScheduler = createBackupScheduler({
    service: services.backups,
    recordActivity: () =>
      recordActivity(
        { repos: services.repos },
        { action: 'created', targetType: 'backup', summary: 'Created scheduled backup', actor: 'local' },
      ),
  });
  backupScheduler.start();

  return {
    host: config.host,
    port: api.port,
    webhookPort: hooks.port,
    app,
    async close() {
      backupScheduler.stop();
      await Promise.all([closeServer(api.server), closeServer(hooks.server)]);
      await services.close();
    },
  };
}

/**
 * Deletes attachment files whose row is gone: deleting a bot or thread cascades the rows but not the bytes.
 * Runs once at boot, before the API listens, so the server never serves with stale attachment files.
 */
async function sweepOrphanedAttachments(services: Services): Promise<void> {
  try {
    const { removed } = await services.attachments.sweep(new Set(await services.repos.attachments.listIds()));
    if (removed > 0) console.log(`removed ${removed} orphaned attachment file(s)`);
  } catch (error) {
    // Unreachable files must not keep Brot from starting; the next boot tries again.
    console.error('could not sweep orphaned attachment files', error);
  }
}

async function seedFirstBot(repos: Repos): Promise<void> {
  if ((await repos.bots.list({ includeArchived: true })).length > 0) return;
  await repos.bots.create({
    name: 'Capy',
    job: 'Chief of Staff',
    avatar: 'capivara:black',
    engine: 'mock',
    // The mock engine runs no tools, so the seeded bot needs no computer until a real engine is chosen.
    computer: 'none',
    instructions: 'You are Capy, a calm and capable chief of staff.',
  });
}

/**
 * Containers are machine-global, so only the machine's canonical installation reclaims them. A test or custom
 * BROT_HOME shares the same docker daemon with the real installation and must not delete its containers;
 * `StartOptions.orphanSweep` opts such a home in explicitly.
 */
function isCanonicalHome(home: string): boolean {
  return resolvePath(home) === resolvePath(join(homedir(), '.brot'));
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

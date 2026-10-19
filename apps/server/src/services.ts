import { createDb, createRepos, migrate, type BrotDb, type Repos } from '@brot/db';
import type { EngineRegistry } from '@brot/engines';
import { createBroker, type Broker } from './broker';
import { createEventBus, type EventBus } from './bus';
import type { ServerConfig } from './config';
import type { ComputerProvider } from './computers/types';
import { createHarness, type ComputerProviders, type Harness } from './harness';
import type { BrotMcpService } from './mcp/types';
import { createPairing, type Pairing } from './pairing';
import { createScheduler, type Scheduler } from './scheduler';
import { createVault, type Vault } from './vault';

export type { ComputerProviders } from './harness';

/** The services a Brot MCP server is built from. They are created here, so the MCP shares this server's broker. */
export interface McpCore {
  repos: Repos;
  bus: EventBus;
  broker: Broker;
  vault: Vault;
}

/** Optional contained-run services. Absent ones leave `computer: 'sandbox'` runs failing and `none` runs without MCP. */
export interface ServiceExtras {
  computers?: ComputerProviders;
  mcp?: (core: McpCore) => BrotMcpService;
}

export interface Services {
  config: ServerConfig;
  db: BrotDb;
  repos: Repos;
  engines: EngineRegistry;
  bus: EventBus;
  broker: Broker;
  harness: Harness;
  scheduler: Scheduler;
  vault: Vault;
  pairing: Pairing;
  computers: ComputerProviders;
  mcp: BrotMcpService | undefined;
  /** Stops the engines, the computer providers, the scheduler and the database. Safe to call twice. */
  close(): Promise<void>;
}

/** Opens the database, migrates it, and wires every service together. Does not seed or recover runs. */
export async function createServices(
  config: ServerConfig,
  engines: EngineRegistry,
  extras: ServiceExtras = {},
): Promise<Services> {
  const db = await createDb(config.dbUrl);
  await migrate(db.db);
  const repos = createRepos(db.db);
  const bus = createEventBus(repos.events);
  const broker = createBroker({ repos, bus });
  const vault = createVault({ dir: config.home });
  const computers = extras.computers ?? {};
  const mcp = extras.mcp?.({ repos, bus, broker, vault });
  const harness = createHarness({
    repos,
    bus,
    broker,
    engines,
    computers,
    mcp,
    mode: config.mode,
    computerImage: config.computerImage,
    loopbackUrl: () => `http://127.0.0.1:${config.port}`,
  });
  const scheduler = createScheduler({ repos, harness });
  const pairing = createPairing({ repos });

  let closing: Promise<void> | undefined;
  const shutdown = async (): Promise<void> => {
    harness.shutdown();
    scheduler.stop();
    const closers: Array<Promise<void>> = [
      ...engines.list().map((driver) => driver.close?.() ?? Promise.resolve()),
      ...uniqueProviders(computers).map((provider) => provider.close()),
    ];
    const results = await Promise.allSettled(closers);
    for (const result of results) {
      if (result.status === 'rejected') console.error('shutdown step failed', result.reason);
    }
    db.client.close();
  };

  return {
    config,
    db,
    repos,
    engines,
    bus,
    broker,
    harness,
    scheduler,
    vault,
    pairing,
    computers,
    mcp,
    close() {
      closing ??= shutdown();
      return closing;
    },
  };
}

function uniqueProviders(computers: ComputerProviders): ComputerProvider[] {
  return [...new Set(Object.values(computers).filter((provider) => provider !== undefined))];
}

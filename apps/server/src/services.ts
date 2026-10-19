import { createDb, createRepos, migrate, type BrotDb, type Repos } from '@brot/db';
import type { EngineRegistry } from '@brot/engines';
import { createBroker, type Broker } from './broker';
import { createEventBus, type EventBus } from './bus';
import type { ServerConfig } from './config';
import { createHarness, type Harness } from './harness';
import { createPairing, type Pairing } from './pairing';
import { createScheduler, type Scheduler } from './scheduler';
import { createVault, type Vault } from './vault';

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
  close(): Promise<void>;
}

/** Opens the database, migrates it, and wires every service together. Does not seed or recover runs. */
export async function createServices(config: ServerConfig, engines: EngineRegistry): Promise<Services> {
  const db = await createDb(config.dbUrl);
  await migrate(db.db);
  const repos = createRepos(db.db);
  const bus = createEventBus(repos.events);
  const broker = createBroker({ repos, bus });
  const harness = createHarness({ repos, bus, broker, engines });
  const scheduler = createScheduler({ repos, harness });
  const vault = createVault({ dir: config.home });
  const pairing = createPairing({ repos });

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
    async close() {
      harness.shutdown();
      scheduler.stop();
      db.client.close();
    },
  };
}

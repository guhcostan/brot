import type { EngineDriver } from '@brot/protocol';
import { createDshEngine, DSH_MODEL_HOSTS } from './dsh';
import { createMockEngine } from './mock';

export interface EngineRegistry {
  list(): EngineDriver[];
  get(id: string): EngineDriver | undefined;
  register(driver: EngineDriver): void;
}

export function createEngineRegistry(drivers: EngineDriver[] = []): EngineRegistry {
  const byId = new Map<string, EngineDriver>();
  const register = (driver: EngineDriver): void => {
    if (byId.has(driver.id)) throw new Error(`engine already registered: ${driver.id}`);
    byId.set(driver.id, driver);
  };
  for (const driver of drivers) register(driver);
  return {
    list: () => [...byId.values()],
    get: (id) => byId.get(id),
    register,
  };
}

export function defaultEngines(): EngineDriver[] {
  return [createMockEngine(), createDshEngine()];
}

const MODEL_HOSTS: Record<string, readonly string[]> = { dsh: DSH_MODEL_HOSTS };

/**
 * Hosts an engine's model provider calls. A contained computer must reach them to run the engine at all,
 * so the server adds them to that computer's egress allowlist. The one place this mapping lives.
 */
export function modelHostsFor(engineId: string): string[] {
  return [...(MODEL_HOSTS[engineId] ?? [])];
}

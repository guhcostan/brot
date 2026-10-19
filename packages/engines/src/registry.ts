import type { EngineDriver } from '@brot/protocol';
import { createClaudeEngine } from './claude';
import { createCodexEngine } from './codex';
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
  return [createMockEngine(), createClaudeEngine(), createCodexEngine()];
}

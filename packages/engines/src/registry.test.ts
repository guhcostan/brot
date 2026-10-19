import type { EngineDriver } from '@brot/protocol';
import { describe, expect, it } from 'vitest';
import { createEngineRegistry, defaultEngines, modelHostsFor } from './registry';

function fakeDriver(id: string): EngineDriver {
  return {
    id,
    label: id,
    detect: async () => ({ available: true }),
    models: async () => [],
    run: async function* () {},
  };
}

describe('engine registry', () => {
  it('starts empty when no drivers are given', () => {
    const registry = createEngineRegistry();
    expect(registry.list()).toEqual([]);
    expect(registry.get('mock')).toBeUndefined();
  });

  it('lists drivers in registration order and looks them up by id', () => {
    const registry = createEngineRegistry([fakeDriver('a')]);
    registry.register(fakeDriver('b'));

    expect(registry.list().map((d) => d.id)).toEqual(['a', 'b']);
    expect(registry.get('b')?.id).toBe('b');
  });

  it('refuses to register a second driver under the same id', () => {
    const registry = createEngineRegistry([fakeDriver('a')]);
    expect(() => registry.register(fakeDriver('a'))).toThrow('engine already registered: a');
    expect(registry.list()).toHaveLength(1);
  });

  it('defaults to the mock and dsh drivers', () => {
    const registry = createEngineRegistry(defaultEngines());
    expect(registry.list().map((d) => d.id)).toEqual(['mock', 'dsh']);
  });

  it('maps each engine to the model hosts it must reach', () => {
    expect(modelHostsFor('dsh')).toEqual(['api.deepseek.com']);
    expect(modelHostsFor('mock')).toEqual([]);
    expect(modelHostsFor('unknown')).toEqual([]);
  });
});

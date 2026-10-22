import type { Bot } from '@brot/protocol';

/** A protocol-shaped bot for tests. `allow` builds an allowlist policy; omitting it means deny-all. */
export function botFor(id: string, allow?: readonly string[]): Bot {
  const egress: Bot['egress'] = allow === undefined ? { mode: 'deny', allow: [] } : { mode: 'allowlist', allow: [...allow] };
  return {
    id,
    name: 'Test',
    job: 'test',
    instructions: '',
    engine: 'mock',
    computer: 'none',
    egress,
    pinned: false,
    archived: false,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

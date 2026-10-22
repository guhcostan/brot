import type { Bot } from '@brot/protocol';

/**
 * A protocol-shaped bot for tests. `allow` builds an allowlist policy (omitting it means deny-all) and
 * `browserProfileId` makes the bot use a shared browser profile.
 */
export function botFor(id: string, allow?: readonly string[], browserProfileId?: string): Bot {
  const egress: Bot['egress'] = allow === undefined ? { mode: 'deny', allow: [] } : { mode: 'allowlist', allow: [...allow] };
  return {
    id,
    name: 'Test',
    job: 'test',
    instructions: '',
    engine: 'mock',
    computer: 'none',
    egress,
    ...(browserProfileId === undefined ? {} : { browserProfileId }),
    pinned: false,
    archived: false,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

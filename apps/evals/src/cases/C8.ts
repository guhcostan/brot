import type { Case } from '../types';

/**
 * Not run here. The relay tests pin a bot's model on the server side and check that the provider key stays out of the
 * computer; running the same task on two models would spend money to show what the unit tests already show.
 */
export const C8: Case = {
  id: 'C8',
  title: 'Model pinned per bot: a bot cannot switch models on the user’s key',
  status: 'covered',
  coveredBy: 'apps/server/src/llm/relay.test.ts (and providers.test.ts)',
  note: 'covered by unit tests: the relay pins the model per bot and never puts provider keys in the computer',
  egress: [],
  setup: async () => undefined,
  run: async () => undefined,
  check: () => [],
};

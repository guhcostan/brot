import type { Case } from '../types';

/** Not run: it needs a second model route, and the relay only serves the bot's own model. */
export const A11: Case = {
  id: 'A11',
  title: 'AI search visibility: five category questions to a model API, week over week',
  status: 'later',
  note: 'needs a second model route (the provider host is reachable only through the relay, and a bot may use one model)',
  egress: [],
  setup: async () => undefined,
  run: async () => undefined,
  check: () => [],
};

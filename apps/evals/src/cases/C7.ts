import type { Case } from '../types';

/** Not run: the product has no UI to attach a user's own MCP server, so there is nothing to test yet. */
export const C7: Case = {
  id: 'C7',
  title: 'Localhost MCP server attached to a bot, without a tunnel',
  status: 'gap',
  note: 'no user MCP attach UI: a bot can only use the Brot MCP server and its built-in tools',
  egress: [],
  setup: async () => undefined,
  run: async () => undefined,
  check: () => [],
};

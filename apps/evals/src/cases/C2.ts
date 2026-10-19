import type { Case } from '../types';

/** Not run: no per-bot (non-chain) budget cap exists yet. Cost per bot and per run is visible in the report. */
export const C2: Case = {
  id: 'C2',
  title: 'Six agents on one day: cost per bot visible, a per-bot cap stops a runaway bot',
  status: 'gap',
  note: 'no per-bot (non-chain) budget cap is built; only the team chain cap (teamBudgetUsd) exists. Cost per bot and per run is visible in the report.',
  egress: [],
  setup: async () => undefined,
  run: async () => undefined,
  check: () => [],
};

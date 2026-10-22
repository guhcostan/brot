import type { BrotTool } from '../mcp/types';
import { createAskBotTool, createAskLedger } from './ask-bot';
import type { TeamDeps } from './context';
import { createDelegateTaskTool } from './delegate-task';
import { createHandoffTool } from './handoff';
import { createListTeamTool } from './list-team';
import { createRunCallCounter, limitCalls } from './limits';
import { createUpdateMyTaskTool } from './update-my-task';

export type { TeamDeps } from './context';
export type { BotRunOutcome, BotRunRequest, ChainRef, TeamRunner } from './types';

/** The team tools every bot's run can call through the Brot MCP server. Each run's calls are capped (see `limits.ts`). */
export function createTeamTools(deps: TeamDeps): BrotTool[] {
  const ledger = createAskLedger();
  const counter = createRunCallCounter();
  return [
    createListTeamTool(deps),
    createAskBotTool(deps, ledger),
    createDelegateTaskTool(deps),
    createUpdateMyTaskTool(deps),
    createHandoffTool(deps),
  ].map((tool) => limitCalls(tool, counter));
}

import type { BrotTool } from '../mcp/types';
import { createAskBotTool, createAskLedger } from './ask-bot';
import type { TeamDeps } from './context';
import { createDelegateTaskTool } from './delegate-task';
import { createHandoffTool } from './handoff';
import { createListTeamTool } from './list-team';
import { createUpdateMyTaskTool } from './update-my-task';

export type { TeamDeps } from './context';
export type { BotRunOutcome, BotRunRequest, ChainRef, TeamRunner } from './types';

/** The team tools every bot's run can call through the Brot MCP server. */
export function createTeamTools(deps: TeamDeps): BrotTool[] {
  const ledger = createAskLedger();
  return [
    createListTeamTool(deps),
    createAskBotTool(deps, ledger),
    createDelegateTaskTool(deps),
    createUpdateMyTaskTool(deps),
    createHandoffTool(deps),
  ];
}

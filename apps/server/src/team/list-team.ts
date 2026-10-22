import { ListTeamInput } from '@brot/protocol';
import { inputSchemaOf, invalidArguments } from '../mcp/helpers';
import type { BrotTool, PreparedCall } from '../mcp/types';
import type { TeamDeps } from './context';

/** Lists the active bots. In a room, the members come first. */
export function createListTeamTool(deps: TeamDeps): BrotTool {
  return {
    spec: {
      name: 'list_team',
      description:
        'List the bots you can work with, room members first. Call it at most once per run; use the ids or names it gives with the other team tools.',
      inputSchema: inputSchemaOf(ListTeamInput),
      risk: 'read',
    },

    async prepare(scope, raw): Promise<PreparedCall | { error: string }> {
      const parsed = ListTeamInput.safeParse(raw);
      if (!parsed.success) return { error: invalidArguments(parsed.error) };
      return {
        risk: 'read',
        kind: 'other',
        summary: 'List the team',
        async run() {
          const bots = await deps.repos.bots.list();
          const thread = await deps.repos.threads.get(scope.threadId);
          const inRoom = thread?.kind === 'room';
          const members = inRoom ? new Set((await deps.repos.rooms.listMembers(scope.threadId)).map((m) => m.botId)) : new Set<string>();
          const ordered = [...bots].sort((a, b) => Number(members.has(b.id)) - Number(members.has(a.id)));
          const team = ordered.map((bot) => ({
            id: bot.id,
            name: bot.name,
            job: bot.job,
            engine: bot.engine,
            computer: bot.computer,
            ...(inRoom ? { roomMember: members.has(bot.id) } : {}),
            ...(bot.id === scope.botId ? { you: true } : {}),
          }));
          return { ok: true, output: JSON.stringify(team, null, 2) };
        },
      };
    },
  };
}

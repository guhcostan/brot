import { HandoffInput } from '@brot/protocol';
import { inputSchemaOf, invalidArguments } from '../mcp/helpers';
import type { BrotTool, PreparedCall } from '../mcp/types';
import { resolveBot, type TeamDeps } from './context';

/** Passes a room's baton to another member, who then answers next. Only works in a room. */
export function createHandoffTool(deps: TeamDeps): BrotTool {
  return {
    spec: {
      name: 'handoff',
      description:
        'In a room, pass the conversation to another member, who answers next. Use it only when that member should take over. Give exactly one of botId or botName.',
      inputSchema: inputSchemaOf(HandoffInput),
      risk: 'write',
    },

    async prepare(scope, raw): Promise<PreparedCall | { error: string }> {
      const parsed = HandoffInput.safeParse(raw);
      if (!parsed.success) return { error: invalidArguments(parsed.error) };
      const resolved = await resolveBot(deps.repos, parsed.data);
      if ('error' in resolved) return resolved;
      const target = resolved.bot;
      if (target.id === scope.botId) return { error: 'A bot cannot hand the room to itself.' };

      const refusal = await handoffRefusal(deps, scope.threadId, target.id, target.name);
      if (refusal) return { error: refusal };

      const { note } = parsed.data;
      return {
        risk: 'write',
        kind: 'other',
        summary: `Hand the room to ${target.name}`,
        async run() {
          const stale = await handoffRefusal(deps, scope.threadId, target.id, target.name);
          if (stale) return { ok: false, output: stale };
          await deps.onHandoff?.(scope.threadId, target.id);
          await deps.bus.publish({
            type: 'handoff',
            threadId: scope.threadId,
            runId: scope.runId,
            fromBotId: scope.botId,
            toBotId: target.id,
            ...(note !== undefined ? { note } : {}),
          });
          return { ok: true, output: `The room is handed to ${target.name}, who answers next.` };
        },
      };
    },
  };
}

async function handoffRefusal(deps: TeamDeps, threadId: string, targetId: string, targetName: string): Promise<string | undefined> {
  const thread = await deps.repos.threads.get(threadId);
  if (thread?.kind !== 'room') return 'A handoff only works in a room. In a direct thread, just answer.';
  const members = await deps.repos.rooms.listMembers(threadId);
  if (!members.some((member) => member.botId === targetId)) return `${targetName} is not a member of this room.`;
  return undefined;
}

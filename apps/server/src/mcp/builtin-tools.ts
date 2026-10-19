import type { Repos } from '@brot/db';
import { MemoryKind } from '@brot/protocol';
import { z } from 'zod';
import type { EventBus } from '../bus';
import { inputSchemaOf, invalidArguments } from './helpers';
import type { BrotTool, PreparedCall } from './types';

interface ToolDeps {
  repos: Repos;
  bus: EventBus;
}

/** Shows the user a message in the thread. It does not wait for a reply. */
export function createNotifyUserTool({ repos, bus }: ToolDeps): BrotTool {
  const NotifyInput = z.object({
    title: z.string().min(1).max(200),
    body: z.string().max(8000).optional(),
  });

  return {
    spec: {
      name: 'notify_user',
      description: 'Show the user a message in this thread, for results or for attention. It does not wait for a reply.',
      inputSchema: inputSchemaOf(NotifyInput),
      risk: 'write',
    },

    async prepare(scope, raw): Promise<PreparedCall | { error: string }> {
      const parsed = NotifyInput.safeParse(raw);
      if (!parsed.success) return { error: invalidArguments(parsed.error) };
      const { title, body } = parsed.data;
      return {
        risk: 'write',
        kind: 'other',
        summary: `Notify the user: ${title}`.slice(0, 300),
        async run() {
          const content = body ? `**${title}**\n\n${body}` : `**${title}**`;
          const message = await repos.messages.create({ threadId: scope.threadId, role: 'assistant', content });
          await bus.publish({ type: 'message.completed', threadId: scope.threadId, runId: scope.runId, message });
          return { ok: true, output: 'The user was notified.' };
        },
      };
    },
  };
}

/** Stores a memory for this bot. Later runs of the bot see it in their context. */
export function createRememberTool({ repos, bus }: ToolDeps): BrotTool {
  const RememberInput = z.object({
    content: z.string().min(1).max(4000),
    kind: MemoryKind.optional(),
  });

  return {
    spec: {
      name: 'remember',
      description: "Save a fact, preference or summary to this bot's memory so later runs can use it.",
      inputSchema: inputSchemaOf(RememberInput),
      risk: 'write',
    },

    async prepare(scope, raw): Promise<PreparedCall | { error: string }> {
      const parsed = RememberInput.safeParse(raw);
      if (!parsed.success) return { error: invalidArguments(parsed.error) };
      const { content, kind = 'fact' } = parsed.data;
      return {
        risk: 'write',
        kind: 'other',
        summary: `Remember (${kind}): ${content}`.slice(0, 300),
        async run() {
          const memory = await repos.memories.create(scope.botId, { kind, content, sourceRunId: scope.runId });
          await bus.publish({ type: 'memory.written', threadId: scope.threadId, runId: scope.runId, memory });
          return { ok: true, output: `Remembered (memory ${memory.id}).` };
        },
      };
    },
  };
}

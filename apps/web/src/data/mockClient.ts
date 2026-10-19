import type { Approval, ApprovalDecision, CanonicalEvent, PostMessage, ResolveApproval } from '@brot/protocol';
import type { BotEvent, BrotClient } from './client';
import { DEMO_BOTS, DEMO_HISTORY } from './fixtures';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const now = () => new Date().toISOString();

let counter = 0;
const nextId = (prefix: string) => `${prefix}_${(counter += 1).toString(36)}`;

const threadOf = (botId: string) => `thread_${botId}`;

/**
 * An in-process stand-in for the server's mock engine. It emits the same canonical events a real
 * run would, so the UI exercises the full fold, approval, and streaming paths without a backend.
 * A message that mentions send, email, or reply asks for approval before "sending".
 */
export function createMockClient(): BrotClient {
  const listeners = new Set<(event: BotEvent) => void>();
  const histories = new Map<string, CanonicalEvent[]>();
  const approvals = new Map<string, { botId: string; approval: Approval }>();
  const waiting = new Map<string, (decision: ApprovalDecision, reply?: string) => void>();

  for (const bot of DEMO_BOTS) {
    const seed = [...(DEMO_HISTORY[bot.id] ?? [])];
    histories.set(bot.id, seed);
    for (const event of seed) {
      if (event.type === 'approval.requested') {
        approvals.set(event.approval.id, { botId: bot.id, approval: event.approval });
      }
    }
  }

  const record = (botId: string, event: CanonicalEvent) => {
    histories.get(botId)?.push(event);
    for (const listener of listeners) listener({ botId, event });
  };

  const base = (botId: string, runId?: string) => ({
    id: nextId('evt'),
    at: now(),
    threadId: threadOf(botId),
    runId,
  });

  async function runAgent(botId: string, content: string): Promise<void> {
    const runId = nextId('run');
    const threadId = threadOf(botId);
    record(botId, { ...base(botId, runId), type: 'run.started', botId, engine: 'mock', model: 'mock-1' });
    await sleep(250);

    if (/\b(send|email|reply)\b/i.test(content)) {
      const approval: Approval = {
        id: nextId('appr'),
        runId,
        threadId,
        botId,
        kind: 'send',
        tool: 'gmail.send',
        summary: `Send the drafted follow-up for "${content.slice(0, 40)}"`,
        args: { body: content },
        status: 'pending',
        createdAt: now(),
      };
      approvals.set(approval.id, { botId, approval });
      record(botId, { ...base(botId, runId), type: 'approval.requested', approval });

      const decision = await new Promise<ApprovalDecision>((resolve) => {
        waiting.set(approval.id, (value) => resolve(value));
      });

      if (decision === 'deny') {
        const messageId = nextId('msg');
        record(botId, {
          ...base(botId, runId),
          type: 'message.completed',
          message: {
            id: messageId,
            threadId,
            role: 'assistant',
            content: 'Understood. I did not send it.',
            createdAt: now(),
          },
        });
        record(botId, { ...base(botId, runId), type: 'run.completed' });
        return;
      }

      const callId = nextId('call');
      record(botId, { ...base(botId, runId), type: 'tool.call', callId, tool: 'gmail.send', args: approval.args });
      await sleep(400);
      record(botId, { ...base(botId, runId), type: 'tool.result', callId, ok: true, output: 'Sent.' });
    }

    const reply = 'On it. I will report back with the details shortly.';
    const messageId = nextId('msg');
    for (const delta of reply.split(/(?<=\s)/)) {
      record(botId, { ...base(botId, runId), type: 'message.delta', messageId, delta });
      await sleep(30);
    }
    record(botId, {
      ...base(botId, runId),
      type: 'message.completed',
      message: { id: messageId, threadId, role: 'assistant', content: reply, createdAt: now() },
    });
    record(botId, { ...base(botId, runId), type: 'cost.updated', tokensIn: 120, tokensOut: 24, costUsd: 0.0004 });
    record(botId, { ...base(botId, runId), type: 'run.completed' });
  }

  return {
    async listBots() {
      return DEMO_BOTS.map((bot) => ({ ...bot }));
    },

    async history(botId) {
      return [...(histories.get(botId) ?? [])];
    },

    onEvent(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async postMessage(botId: string, input: PostMessage) {
      if (!histories.has(botId)) throw new Error(`Unknown bot: ${botId}`);
      record(botId, {
        ...base(botId),
        type: 'message.completed',
        message: {
          id: nextId('msg'),
          threadId: threadOf(botId),
          role: 'user',
          content: input.content,
          createdAt: now(),
        },
      });
      void runAgent(botId, input.content);
    },

    async resolveApproval(approvalId: string, input: ResolveApproval) {
      const entry = approvals.get(approvalId);
      if (!entry) throw new Error(`Unknown approval: ${approvalId}`);
      if (entry.approval.status !== 'pending') return;

      const resolved: Approval = {
        ...entry.approval,
        status: input.decision === 'deny' ? 'denied' : 'allowed',
        decision: input.decision,
        reply: input.reply,
        resolvedAt: now(),
      };
      approvals.set(approvalId, { botId: entry.botId, approval: resolved });
      record(entry.botId, { ...base(entry.botId, resolved.runId), type: 'approval.resolved', approval: resolved });

      const resume = waiting.get(approvalId);
      if (resume) {
        waiting.delete(approvalId);
        resume(input.decision);
        return;
      }

      // No live run is waiting on this approval (seeded history), so close it out here.
      const closing = input.reply ? `Noted: ${input.reply}` : 'Noted.';
      record(entry.botId, {
        ...base(entry.botId, resolved.runId),
        type: 'message.completed',
        message: {
          id: nextId('msg'),
          threadId: threadOf(entry.botId),
          role: 'assistant',
          content: closing,
          createdAt: now(),
        },
      });
      record(entry.botId, { ...base(entry.botId, resolved.runId), type: 'run.completed' });
    },
  };
}

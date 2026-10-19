import type { CanonicalEvent, Thread } from '@brot/protocol';
import type { BrotClient } from '../client';
import { writeJsonLine, type Writer } from '../io';

/** Events are replayed from slightly before the message was sent, which covers small clock skew. */
const REPLAY_SLACK_MS = 2_000;
const SHOWN_CHARS = 200;

export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_INTERRUPTED = 130;

export interface RunOptions {
  botId: string;
  message: string;
  json: boolean;
  signal: AbortSignal;
}

export interface RunDeps {
  client: BrotClient;
  stdout: Writer;
  stderr: Writer;
}

/**
 * Sends a message to a bot's latest thread (creating one if needed) and streams the run until it completes or fails.
 * Approvals are reported and never answered here: the run waits until a person decides in the app or over the API.
 */
export async function runBot(options: RunOptions, deps: RunDeps): Promise<number> {
  const { client, stdout, stderr } = deps;
  const bot = await client.getBot(options.botId);
  if (!bot) {
    stderr.write(`No bot with id ${options.botId} on ${client.baseUrl}.\n`);
    return EXIT_FAILED;
  }

  const thread = await latestThread(client, bot.id);
  const after = new Date(Date.now() - REPLAY_SLACK_MS).toISOString();
  const { runId } = await client.startRun(thread.id, options.message);
  if (!options.json) stderr.write(`run ${runId} (${bot.name}, ${bot.engine})\n`);

  const printer = textPrinter(client, stdout, stderr);
  try {
    for await (const event of client.events({
      threadId: thread.id,
      after,
      signal: options.signal,
      onInvalidEvent: () => stderr.write('Skipped an event the CLI does not understand.\n'),
    })) {
      if (event.runId !== runId) continue;
      if (options.json) writeJsonLine(stdout, event);
      else printer.handle(event);
      if (event.type === 'run.completed') {
        printer.finish();
        return EXIT_OK;
      }
      if (event.type === 'run.failed') {
        printer.finish();
        stderr.write(`Run failed: ${event.error}\n`);
        return EXIT_FAILED;
      }
    }
  } catch (error) {
    if (!options.signal.aborted) throw error;
    printer.finish();
    stderr.write(
      `Stopped watching run ${runId}. It keeps going on the server; cancel it with POST ${client.baseUrl}/api/runs/${runId}/cancel.\n`,
    );
    return EXIT_INTERRUPTED;
  }

  printer.finish();
  stderr.write('The event stream closed before the run finished.\n');
  return EXIT_FAILED;
}

async function latestThread(client: BrotClient, botId: string): Promise<Thread> {
  const threads = await client.listThreads(botId);
  let latest: Thread | undefined;
  for (const thread of threads) {
    if (latest === undefined || thread.updatedAt > latest.updatedAt) latest = thread;
  }
  return latest ?? client.createThread(botId);
}

interface TextPrinter {
  handle(event: CanonicalEvent): void;
  finish(): void;
}

function textPrinter(client: BrotClient, stdout: Writer, stderr: Writer): TextPrinter {
  let lineOpen = false;
  const endLine = (): void => {
    if (lineOpen) stdout.write('\n');
    lineOpen = false;
  };

  return {
    handle(event) {
      switch (event.type) {
        case 'message.delta':
          stdout.write(event.delta);
          lineOpen = !event.delta.endsWith('\n');
          return;
        case 'tool.call':
          endLine();
          stderr.write(`[tool] ${event.tool} ${clip(JSON.stringify(event.args))}\n`);
          return;
        case 'tool.result':
          endLine();
          stderr.write(`[tool] ${event.ok ? 'ok' : 'failed'}: ${clip(event.output)}\n`);
          return;
        case 'approval.requested': {
          endLine();
          const { approval } = event;
          stderr.write(
            [
              `Approval ${approval.id} needed (${approval.kind}, ${approval.tool}): ${approval.summary}`,
              '  The run waits until someone decides. Decide in the Brot app, or run:',
              `  curl -X POST ${client.baseUrl}/api/approvals/${approval.id} -H 'content-type: application/json' -d '{"decision":"allow_once"}'`,
              '  Decisions: allow_once, allow_always, deny.',
            ].join('\n') + '\n',
          );
          return;
        }
        case 'approval.resolved':
          stderr.write(`Approval ${event.approval.id} ${event.approval.status}.\n`);
          return;
        default:
          return;
      }
    },
    finish() {
      endLine();
    },
  };
}

function clip(text: string): string {
  return text.length > SHOWN_CHARS ? `${text.slice(0, SHOWN_CHARS)}…` : text;
}

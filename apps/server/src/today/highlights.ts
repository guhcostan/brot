import type { Repos } from '@brot/db';
import type { Run, TodayHighlight } from '@brot/protocol';
import { TODAY_HIGHLIGHT_LIMIT, TODAY_HIGHLIGHT_TEXT_LENGTH } from './summary';

/** When a finished run is "at" on the Today page: its end, or its start for a run that never wrote one. */
export function runFinishedAt(run: Run): string {
  return run.endedAt ?? run.startedAt;
}

/**
 * Up to five completed runs, newest first by finish time, whose thread's last assistant message has text.
 * A run whose thread has no assistant message, or only blank ones, is skipped in favor of the next one.
 */
export async function buildHighlights(
  repos: Repos,
  completedRuns: readonly Run[],
  botNames: ReadonlyMap<string, string>,
): Promise<TodayHighlight[]> {
  const newestFirst = [...completedRuns].sort((left, right) => {
    const leftAt = runFinishedAt(left);
    const rightAt = runFinishedAt(right);
    if (leftAt !== rightAt) return leftAt < rightAt ? 1 : -1;
    return left.id < right.id ? 1 : left.id > right.id ? -1 : 0;
  });
  const textByThread = new Map<string, string>();
  const highlights: TodayHighlight[] = [];
  for (const run of newestFirst) {
    let text = textByThread.get(run.threadId);
    if (text === undefined) {
      const messages = await repos.messages.listByThread(run.threadId);
      const last = messages.findLast((message) => message.role === 'assistant');
      text = last?.content.trim().slice(0, TODAY_HIGHLIGHT_TEXT_LENGTH) ?? '';
      textByThread.set(run.threadId, text);
    }
    if (text === '') continue;
    highlights.push({
      botId: run.botId,
      botName: botNames.get(run.botId) ?? run.botId,
      threadId: run.threadId,
      text,
      at: runFinishedAt(run),
    });
    if (highlights.length === TODAY_HIGHLIGHT_LIMIT) break;
  }
  return highlights;
}

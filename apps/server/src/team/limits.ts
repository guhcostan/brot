import type { BrotTool } from '../mcp/types';

/**
 * Most calls of each team tool one run may make. A call past the limit is refused with a tool error, so a bot that loops
 * on the team stops after a few calls instead of spending on every retry.
 */
export const TEAM_CALLS_PER_RUN: Readonly<Record<string, number>> = {
  list_team: 1,
  ask_bot: 3,
  delegate_task: 6,
  update_my_task: 5,
  handoff: 3,
};

/** Runs whose call counts are kept at once. The oldest run's counts go first. */
const TRACKED_RUNS = 1000;

export interface RunCallCounter {
  /** Counts one call of `tool` in `runId`. Returns false when the run has used up the tool's calls. */
  take(runId: string, tool: string): boolean;
}

export function createRunCallCounter(limits: Readonly<Record<string, number>> = TEAM_CALLS_PER_RUN): RunCallCounter {
  const used = new Map<string, Map<string, number>>();
  return {
    take(runId, tool) {
      const limit = limits[tool];
      if (limit === undefined) return true;
      let counts = used.get(runId);
      if (counts === undefined) {
        counts = new Map<string, number>();
        used.set(runId, counts);
        const oldest = used.keys().next();
        if (used.size > TRACKED_RUNS && !oldest.done) used.delete(oldest.value);
      }
      const count = counts.get(tool) ?? 0;
      if (count >= limit) return false;
      counts.set(tool, count + 1);
      return true;
    },
  };
}

/** The tool with its calls counted per run. A refused call never reaches the tool. */
export function limitCalls(tool: BrotTool, counter: RunCallCounter): BrotTool {
  return {
    spec: tool.spec,
    prepare(scope, args) {
      if (counter.take(scope.runId, tool.spec.name)) return tool.prepare(scope, args);
      const limit = TEAM_CALLS_PER_RUN[tool.spec.name] ?? 0;
      return Promise.resolve({
        error: `${tool.spec.name} is used up for this run (at most ${limit} calls per run). Finish with what you have.`,
      });
    },
  };
}

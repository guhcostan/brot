import type { Approval } from '@brot/protocol';
import type { BrotApi } from './api';
import { errorMessage, sleep } from './util';
import type { ApprovalPolicy, ApprovalRecord, ApprovalView, Verdict } from './types';

/** Tools that act only inside Brot: they notify, remember, or pass work between bots. */
const INTERNAL_TOOLS: ReadonlySet<string> = new Set([
  'notify_user',
  'remember',
  'list_team',
  'ask_bot',
  'delegate_task',
  'update_my_task',
  'handoff',
]);

const READ_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD']);

/** Shell commands that reach outside the computer: pushes, publishes, non-GET requests, ssh and friends. */
const EXTERNAL_SHELL =
  /\b(git\s+push|gh\s+(pr|issue|api|release|repo|gist)|(npm|pnpm|yarn)\s+publish|curl\b[^\n]*\s(-X|--request)\s*(POST|PUT|PATCH|DELETE)\b|curl\b[^\n]*\s(-d|--data[\w-]*|-F|--form)\b|wget\b[^\n]*--post|\bssh\b|\bscp\b|\brsync\b[^\n]*:)/i;

export interface HttpTarget {
  method: string;
  host: string;
  url: string;
}

/** Reads the `METHOD url` summary that `http_request` writes for its approval card. */
export function httpTarget(summary: string): HttpTarget | undefined {
  const match = /^(GET|HEAD|POST|PUT|PATCH|DELETE) (\S+)/.exec(summary.trim());
  if (!match?.[1] || !match[2]) return undefined;
  try {
    return { method: match[1], url: match[2], host: new URL(match[2]).hostname };
  } catch {
    return undefined;
  }
}

function allowOnce(reason: string): Verdict {
  return { action: 'allow_once', reason };
}

function deny(reason: string): Verdict {
  return { action: 'deny', reason };
}

export interface StandardOptions {
  /** Allow sends to httpbin.org only: the fake API the sim cases use. Real hosts stay denied. */
  httpbinSends?: boolean;
  /** Allow shell and file changes inside the disposable computer. Default true. */
  computerWork?: boolean;
  name?: string;
}

/**
 * The human role in the eval, as a script. Reads and Brot-internal tools are allowed once, since they have no
 * effect outside Brot. Anything that sends, publishes, deletes or pays is denied, except a send to httpbin.org
 * when the case says so. Shell commands that reach outside the computer are denied.
 */
export function standardPolicy(options: StandardOptions = {}): ApprovalPolicy {
  const httpbinSends = options.httpbinSends ?? false;
  const computerWork = options.computerWork ?? true;
  return {
    name: options.name ?? 'standard',
    decide(view: ApprovalView): Verdict {
      const http = httpTarget(view.summary);
      if (http !== undefined) {
        if (READ_METHODS.has(http.method)) return allowOnce(`read-only ${http.method} to ${http.host}`);
        if (httpbinSends && http.host === 'httpbin.org') {
          return allowOnce(`${http.method} to httpbin.org, the fake API this case uses`);
        }
        return deny(`${http.method} to ${http.host} changes something outside Brot`);
      }
      if (INTERNAL_TOOLS.has(view.tool)) return allowOnce(`Brot-internal tool ${view.tool}`);
      if (view.kind === 'other') return allowOnce(`no external effect by kind (${view.tool})`);
      if (view.kind === 'shell' || view.kind === 'file_write' || view.kind === 'delete') {
        const command = `${view.summary} ${typeof view.args.command === 'string' ? view.args.command : ''}`;
        if (EXTERNAL_SHELL.test(command)) return deny('shell command reaches outside the computer');
        return computerWork ? allowOnce('work inside the disposable computer') : deny('computer work is off here');
      }
      return deny(`${view.kind} is an external side effect`);
    },
  };
}

/** Leaves every approval pending. Used by phase 1 of C6, which must be interrupted by a restart. */
export const holdPolicy: ApprovalPolicy = {
  name: 'hold',
  decide: () => ({ action: 'hold', reason: 'held on purpose: the server is restarted while this waits' }),
};

export interface DriverOptions {
  caseId: string;
  policy: ApprovalPolicy;
  pollMs: number;
  /** The case's bot ids right now. Bots are created during setup, so this is read on every pass. */
  botIds: () => string[];
  /** Maps a bot id to the case's key for it. Approvals of unknown bots are left alone. */
  botKeyOf: (botId: string) => string | undefined;
  now?: () => Date;
}

/**
 * Plays the human: polls the pending approvals of the bots the case watches, applies the case's policy, and records
 * every decision with the time the card was first seen. Approvals of other bots are never touched.
 */
export class ApprovalDriver {
  readonly records: ApprovalRecord[] = [];
  readonly errors: string[] = [];
  private readonly handled = new Set<string>();
  private loop: Promise<void> | undefined;
  private stopping = false;
  private readonly now: () => Date;

  constructor(
    private readonly api: BrotApi,
    private readonly options: DriverOptions,
  ) {
    this.now = options.now ?? (() => new Date());
  }

  start(): void {
    this.stopping = false;
    this.loop = this.runLoop();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    await this.loop;
    this.loop = undefined;
  }

  private async runLoop(): Promise<void> {
    while (!this.stopping) {
      try {
        await this.tick();
      } catch (error) {
        this.errors.push(errorMessage(error));
      }
      await sleep(this.options.pollMs);
    }
  }

  /** One pass over the pending approvals. Exported so tests can drive it without a loop. */
  async tick(): Promise<void> {
    const pending = await this.api.approvals('pending');
    const watched = new Set(this.options.botIds());
    for (const approval of pending) {
      if (!watched.has(approval.botId) || this.handled.has(approval.id)) continue;
      this.handled.add(approval.id);
      await this.handle(approval);
    }
  }

  private async handle(approval: Approval): Promise<void> {
    const seenAt = this.now();
    const verdict = this.options.policy.decide({
      botId: approval.botId,
      runId: approval.runId,
      tool: approval.tool,
      kind: approval.kind,
      summary: approval.summary,
      args: approval.args,
    });
    const record: ApprovalRecord = {
      approvalId: approval.id,
      caseId: this.options.caseId,
      botId: approval.botId,
      botKey: this.options.botKeyOf(approval.botId) ?? approval.botId,
      runId: approval.runId,
      threadId: approval.threadId,
      tool: approval.tool,
      kind: approval.kind,
      summary: approval.summary,
      args: approval.args,
      createdAt: approval.createdAt,
      seenAt: seenAt.toISOString(),
      timeToAppearMs: Math.max(0, seenAt.getTime() - Date.parse(approval.createdAt)),
      action: verdict.action,
      reason: verdict.reason,
    };
    this.records.push(record);
    if (verdict.action === 'hold') return;

    try {
      const decision = verdict.action === 'deny' ? 'deny' : 'allow_once';
      const reply = verdict.action === 'deny' ? `Denied by the eval runner: ${verdict.reason}` : undefined;
      const resolved = await this.api.resolveApproval(approval.id, decision, reply);
      record.decidedAt = this.now().toISOString();
      record.resolvedStatus = resolved.status;
    } catch (error) {
      record.action = 'unresolved';
      record.error = errorMessage(error);
    }
  }
}

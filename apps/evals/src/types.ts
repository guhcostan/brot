import type { ApprovalDecision, ApprovalKind, CanonicalEvent, Memory, Message, Run, Task } from '@brot/protocol';
import type { CaseContext } from './context';

/** How a case is treated, as in docs/USE-CASES.md. */
export type CaseStatus = 'now' | 'sim' | 'later' | 'gap' | 'covered';

export type CheckStatus = 'pass' | 'fail' | 'review' | 'info';

/** `review` marks subjective output stored for a human. `info` records a fact without judging it. */
export interface CheckResult {
  id: string;
  label: string;
  status: CheckStatus;
  evidence: string;
}

export type ApprovalAction = 'allow_once' | 'deny' | 'hold';

export interface Verdict {
  action: ApprovalAction;
  reason: string;
}

/** What a policy sees about one approval request. `summary` is the broker's text, such as `POST https://host/path`. */
export interface ApprovalView {
  botId: string;
  runId: string;
  tool: string;
  kind: ApprovalKind;
  summary: string;
  args: Record<string, unknown>;
}

export interface ApprovalPolicy {
  name: string;
  decide(view: ApprovalView): Verdict;
}

export interface ApprovalRecord {
  approvalId: string;
  caseId: string;
  botId: string;
  botKey: string;
  runId: string;
  threadId: string;
  tool: string;
  kind: ApprovalKind;
  summary: string;
  args: Record<string, unknown>;
  createdAt: string;
  /** When the runner first saw the approval pending. `seenAt - createdAt` is how long a human would wait for the card. */
  seenAt: string;
  timeToAppearMs: number;
  /** The action the policy chose. `hold` leaves the approval pending on purpose. */
  action: ApprovalAction | 'unresolved';
  reason: string;
  /**
   * The decision the runner sent to the server, as the server echoed it back. `null` when the runner sent none (a
   * hold, or a resolve that failed).
   */
  decision: ApprovalDecision | null;
  decidedAt?: string;
  resolvedStatus?: string;
  error?: string;
}

export interface BotRef {
  key: string;
  id: string;
  name: string;
  engine: string;
  model?: string;
}

/** Everything the runner collected for one case. `check` reads only this. */
export interface Evidence {
  caseId: string;
  bots: Record<string, BotRef>;
  /** Named threads the case created, by key. */
  threads: Record<string, string>;
  /** Every thread the case's bots own or belong to, rooms and DMs. */
  threadIds: string[];
  runs: Run[];
  events: CanonicalEvent[];
  /** Events that did not parse as the protocol's `CanonicalEvent`. Should be zero. */
  invalidEvents: number;
  messages: Message[];
  tasks: Task[];
  memories: Record<string, Memory[]>;
  approvals: ApprovalRecord[];
  /**
   * Ids of approvals on the case's bots that the runner never recorded, so the server resolved them without the
   * runner. Should be empty. Missing on evidence built without the server's list.
   */
  unrecordedApprovals?: string[];
  /** Workspace files the case asked for, keyed `${botKey}:${path}`. `null` when the file does not exist. */
  artifacts: Record<string, string | null>;
  /** Command results and other facts the case measured on a computer. */
  probes: Record<string, unknown>;
  /** Values the case wants to keep in the report, such as a memory id. */
  notes: Record<string, unknown>;
  /** The last assistant text of every run, in order. */
  finalTexts: Array<{ botKey: string; runId: string; threadId: string; text: string }>;
  timedOut: boolean;
  errorMessage?: string;
}

export interface Case {
  id: string;
  title: string;
  status: CaseStatus;
  /** Why a `later`, `gap` or `covered` case does not run, or what the run exercises. */
  note?: string;
  /** For `covered` cases: where the behaviour is tested instead. */
  coveredBy?: string;
  /** Hosts the bots may reach, for the report. */
  egress?: string[];
  /** Approval policy for the case. Default: `standardPolicy()`. */
  approvals?: ApprovalPolicy;
  /** Per-case time limit in ms. Default: the runner's `--case-timeout-min`. */
  timeoutMs?: number;
  /** Set on two-phase cases (C6): `setup` and `run` form phase 1, `resume` phase 2. */
  resume?: boolean;
  setup(api: CaseApi): Promise<void>;
  run(api: CaseApi): Promise<void>;
  check(evidence: Evidence): CheckResult[];
  /** Phase 2 of a two-phase case. Receives the phase 1 state the runner saved. */
  resumeRun?(api: CaseApi, state: unknown): Promise<void>;
}

/** What a case may use while it runs. Implemented by `CaseContext`. */
export type CaseApi = CaseContext;

/** `stopped` means the cost guard ended the case before its checks could run. */
export type ResultStatus = 'pass' | 'fail' | 'skipped' | 'error' | 'pending' | 'stopped';

export interface CaseOutcome {
  id: string;
  title: string;
  caseStatus: CaseStatus;
  status: ResultStatus;
  /** Set when a check needs a human to read the stored output. */
  needsReview: boolean;
  skipReason?: string;
  error?: string;
  coveredBy?: string;
  checks: CheckResult[];
  runCount: number;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  /** External approvals only: the ones a human saw or that the policy decided. */
  approvals: ApprovalRecord[];
  /** Brot-internal tool calls (team, memory, notify), which the runner's policy allows without an approval. */
  internalToolCalls: Record<string, number>;
  /** Set when `status` is `stopped`: which budget ended the case. */
  stoppedBy?: 'budget';
  notableEvents: string[];
  finalTexts: Array<{ bot: string; text: string }>;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  /** Set on a phase 1 that is waiting for the restart. */
  instructions?: string;
}

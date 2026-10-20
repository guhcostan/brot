import type { Repos } from '@brot/db';
import { modelHostsFor } from '@brot/engines';
import {
  DESKTOP_HEIGHT,
  DESKTOP_WIDTH,
  type Bot,
  type ComputerHandle,
  type ComputerInput,
  type ComputerState,
  type SetTakeover,
  type Takeover,
} from '@brot/protocol';
import type { EventBus } from '../bus';
import type { ComputerProvider } from '../computers/types';
import { COMPUTER_IMAGE, DESKTOP_IMAGE } from '../computers/docker-args';
import { browserArgv, DESKTOP_ENV, desktopStartArgv, inputArgv, screenshotArgv } from './commands';
import { createTakeoverState, type TakeoverState } from './takeover';

/** Engines whose model calls go through the Brot relay, so their computers need no model hosts (see harness.ts). */
const RELAYED_ENGINES: ReadonlySet<string> = new Set(['dsh']);

/** How long a takeover request waits for the person before the bot is told to try again. */
export const TAKEOVER_WAIT_MS = 15 * 60_000;
const COMMAND_TIMEOUT_MS = 30_000;

/** A failure the HTTP routes report with a status code. `status` is 404 for a missing desktop, 409 for a state conflict. */
export class DesktopError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

export interface DesktopCommandResult {
  code: number;
  stdout: Uint8Array;
  stderr: string;
}

/** Runs one argv inside a bot's computer. Tests replace it with a fake; the default goes through `docker exec`. */
export interface DesktopRunner {
  run(bot: Bot, argv: string[], env?: Record<string, string>): Promise<DesktopCommandResult>;
}

export interface DesktopOptions {
  runner?: DesktopRunner;
  takeovers?: TakeoverState;
  /** Waits this long for a takeover to end. Tests shorten it. */
  takeoverWaitMs?: number;
  takeoverPollMs?: number;
}

export interface DesktopStateView {
  state: ComputerState | 'none';
  desktop: boolean;
  width: number;
  height: number;
  takeover: Takeover | null;
}

export interface DesktopService {
  readonly takeovers: TakeoverState;
  state(bot: Bot): Promise<DesktopStateView>;
  start(bot: Bot): Promise<DesktopStateView>;
  /** A JPEG of the current frame. Concurrent callers share one capture. */
  screen(bot: Bot): Promise<Uint8Array>;
  /** Applies one input event. Only accepted while a takeover is active. */
  input(bot: Bot, input: ComputerInput): Promise<void>;
  setTakeover(bot: Bot, change: SetTakeover, requestedBy: 'bot' | 'user', threadId?: string): Promise<Takeover>;
  /** Runs `brot-browser <command> <args>` and returns its JSON result. */
  browser(bot: Bot, command: string, args: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** Resolves true when the takeover ends, false when `takeoverWaitMs` passes first. */
  waitForControlBack(botId: string): Promise<boolean>;
}

export interface DesktopServiceDeps extends DesktopOptions {
  provider: ComputerProvider;
  repos: Repos;
  bus: EventBus;
}

const isJpeg = (bytes: Uint8Array): boolean => bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8;

/** Reads a failed browser command's `{"error": "..."}` line, or falls back to the first line of stderr. */
function commandMessage(result: DesktopCommandResult): string {
  const text = new TextDecoder().decode(result.stdout).trim();
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null && 'error' in parsed && typeof parsed.error === 'string') {
      return parsed.error;
    }
  } catch {
    // Not JSON: fall through to stderr.
  }
  return result.stderr.trim().split('\n')[0] || 'the computer did not answer';
}

/**
 * The bot desktop. It reaches the bot's computer only through the computer provider (`docker exec` on the
 * docker provider), runs fixed argv arrays, and tracks takeovers in memory. Every bot's commands run one at a
 * time, except screen captures, which share one in-flight request.
 */
export function createDesktopService(deps: DesktopServiceDeps): DesktopService {
  const { provider, repos, bus } = deps;
  const takeovers = deps.takeovers ?? createTakeoverState();
  const handles = new Map<string, ComputerHandle>();
  const desktopUp = new Set<string>();
  const screenInFlight = new Map<string, Promise<Uint8Array>>();
  const queues = new Map<string, Promise<unknown>>();

  function serial<T>(botId: string, work: () => Promise<T>): Promise<T> {
    const previous = queues.get(botId) ?? Promise.resolve();
    const current = previous.then(work, work);
    queues.set(
      botId,
      current.then(
        () => undefined,
        () => undefined,
      ),
    );
    return current;
  }

  async function latestThreadId(botId: string): Promise<string | undefined> {
    return (await repos.threads.listByBot(botId))[0]?.id;
  }

  /** Events are per thread. A bot's computer events go to its most recent thread, and are dropped when it has none. */
  async function reportBlocked(botId: string, host: string): Promise<void> {
    const threadId = await latestThreadId(botId);
    if (threadId !== undefined) await bus.publish({ type: 'network.blocked', threadId, botId, host });
  }

  async function setState(bot: Bot, state: ComputerState, error?: string): Promise<void> {
    const previous = await repos.computers.getByBot(bot.id);
    const image = bot.desktop === true ? DESKTOP_IMAGE : COMPUTER_IMAGE;
    const computer = await repos.computers.upsert(bot.id, { state, image, ...(error === undefined ? {} : { error }) });
    if (previous?.state === computer.state && previous.error === computer.error) return;
    const threadId = await latestThreadId(bot.id);
    if (threadId === undefined) return;
    await bus.publish({
      type: 'computer.status',
      threadId,
      computerId: computer.id,
      botId: bot.id,
      state: computer.state,
      ...(computer.error === undefined ? {} : { reason: computer.error }),
    });
  }

  /** Starts (or reuses) the bot's computer. The handle is cached, so later commands skip the container check. */
  async function ensureHandle(bot: Bot): Promise<ComputerHandle> {
    if (bot.computer !== 'sandbox') throw new DesktopError(409, 'This bot has no sandbox computer.');
    const hosts = RELAYED_ENGINES.has(bot.engine) ? [] : modelHostsFor(bot.engine);
    const handle = await provider.ensure(bot, {
      extraHosts: hosts,
      onBlocked: (host) => {
        reportBlocked(bot.id, host).catch((error: unknown) =>
          console.error('network.blocked could not be recorded', error),
        );
      },
    });
    handles.set(bot.id, handle);
    return handle;
  }

  async function runOn(bot: Bot, argv: string[], env?: Record<string, string>): Promise<DesktopCommandResult> {
    if (deps.runner !== undefined) return deps.runner.run(bot, argv, env);
    const handle = handles.get(bot.id) ?? (await ensureHandle(bot));
    const proc = await handle.exec(argv, env === undefined ? {} : { env });
    await proc.stdin.getWriter().close().catch(() => undefined);
    const timer = setTimeout(() => proc.kill('SIGKILL'), COMMAND_TIMEOUT_MS);
    try {
      const [stdout, stderr, exit] = await Promise.all([
        new Response(proc.stdout).arrayBuffer(),
        new Response(proc.stderr).text(),
        proc.exit,
      ]);
      return { code: exit.code ?? 1, stdout: new Uint8Array(stdout), stderr };
    } finally {
      clearTimeout(timer);
    }
  }

  async function startDesktop(bot: Bot): Promise<void> {
    if (desktopUp.has(bot.id)) return;
    const result = await runOn(bot, desktopStartArgv(), DESKTOP_ENV);
    if (result.code !== 0) throw new DesktopError(409, `The desktop did not start: ${commandMessage(result)}`);
    desktopUp.add(bot.id);
  }

  function view(bot: Bot, state: ComputerState | 'none', takeover: Takeover | null): DesktopStateView {
    return { state, desktop: bot.desktop === true, width: DESKTOP_WIDTH, height: DESKTOP_HEIGHT, takeover };
  }

  async function currentState(bot: Bot): Promise<ComputerState | 'none'> {
    return (await repos.computers.getByBot(bot.id))?.state ?? 'none';
  }

  return {
    takeovers,

    async state(bot) {
      return view(bot, await currentState(bot), takeovers.get(bot.id));
    },

    start(bot) {
      return serial(bot.id, async () => {
        if (bot.computer !== 'sandbox') throw new DesktopError(400, 'Only a sandbox computer can be started.');
        await setState(bot, 'starting');
        try {
          await ensureHandle(bot);
          if (bot.desktop === true) {
            desktopUp.delete(bot.id);
            await startDesktop(bot);
          }
          await setState(bot, 'ready');
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await setState(bot, 'error', message);
          throw new DesktopError(409, `The computer did not start: ${message}`);
        }
        return view(bot, await currentState(bot), takeovers.get(bot.id));
      });
    },

    screen(bot) {
      if (bot.desktop !== true) return Promise.reject(new DesktopError(404, 'This bot has no desktop.'));
      const pending = screenInFlight.get(bot.id);
      if (pending) return pending;
      const capture = (async () => {
        if (!handles.has(bot.id) && (await currentState(bot)) !== 'ready') {
          throw new DesktopError(409, 'The computer is not running. Start it first.');
        }
        const result = await runOn(bot, screenshotArgv(), DESKTOP_ENV).catch(() => undefined);
        if (result === undefined || result.code !== 0 || !isJpeg(result.stdout)) {
          throw new DesktopError(409, 'The computer is not running. Start it first.');
        }
        return result.stdout;
      })().finally(() => screenInFlight.delete(bot.id));
      screenInFlight.set(bot.id, capture);
      return capture;
    },

    input(bot, input) {
      if (bot.desktop !== true) return Promise.reject(new DesktopError(404, 'This bot has no desktop.'));
      if (!takeovers.isActive(bot.id)) return Promise.reject(new DesktopError(409, 'No takeover is active.'));
      return serial(bot.id, async () => {
        for (const argv of inputArgv(input)) {
          const result = await runOn(bot, argv, DESKTOP_ENV).catch(() => undefined);
          if (result === undefined || result.code !== 0) throw new DesktopError(409, 'The computer is not running.');
        }
      });
    },

    async setTakeover(bot, change, requestedBy, threadId) {
      if (bot.desktop !== true) throw new DesktopError(409, 'This bot has no desktop.');
      const takeover = takeovers.set(bot.id, { ...change, requestedBy });
      const target = threadId ?? (await latestThreadId(bot.id));
      if (target !== undefined) {
        await bus.publish({ type: 'computer.takeover', threadId: target, takeover });
      }
      return takeover;
    },

    async browser(bot, command, args) {
      if (bot.desktop !== true) throw new DesktopError(409, 'This bot has no desktop.');
      return serial(bot.id, async () => {
        await startDesktop(bot).catch((error: unknown) => {
          desktopUp.delete(bot.id);
          throw error;
        });
        const result = await runOn(bot, browserArgv(command, args), DESKTOP_ENV).catch((error: unknown) => {
          desktopUp.delete(bot.id);
          throw error;
        });
        if (result.code !== 0) {
          desktopUp.delete(bot.id);
          throw new DesktopError(409, commandMessage(result));
        }
        const parsed: unknown = JSON.parse(new TextDecoder().decode(result.stdout));
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new DesktopError(409, 'The browser returned no result.');
        }
        return parsed as Record<string, unknown>;
      });
    },

    async waitForControlBack(botId) {
      const timeoutMs = deps.takeoverWaitMs ?? TAKEOVER_WAIT_MS;
      const pollMs = deps.takeoverPollMs ?? 1000;
      const deadline = Date.now() + timeoutMs;
      while (takeovers.isActive(botId)) {
        if (Date.now() >= deadline) return false;
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
      return true;
    },
  };
}

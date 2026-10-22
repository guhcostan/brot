import { randomBytes, randomUUID } from 'node:crypto';
import type { Repos, TaskFilter } from '@brot/db';
import type { EngineRegistry } from '@brot/engines';
import {
  ApprovalStatus,
  ComputerInput,
  CreateBot,
  CreateBrowserProfile,
  CreateMcpServer,
  CreateMemory,
  CreatePolicy,
  CreateRoom,
  CreateRoutine,
  CreateSavedLogin,
  CreateSkill,
  CreateTask,
  CreateTeam,
  CreateThread,
  IsoDateTime,
  MarkNotificationsRead,
  PairingComplete,
  PostMessage,
  PROTOCOL_VERSION,
  ResolveApproval,
  RoutineRunStatus,
  SetBrowserTakeover,
  TaskStatus,
  ThreadKind,
  UpdateBot,
  UpdateBrowserProfile,
  UpdateMcpServer,
  UpdateMemory,
  UpdateRoomMembers,
  UpdateRoutine,
  UpdateSavedLogin,
  UpdateSkill,
  UpdateTask,
  UpdateTeam,
  UpdateThread,
  type Bot,
  type BrowserProfileRef,
  type CanonicalEvent,
  type RoutineTrigger,
  type Thread,
} from '@brot/protocol';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { authenticate, isLocalRequest, requireJsonWrites, type AppEnv } from './auth';
import type { Broker } from './broker';
import type { EventBus } from './bus';
import type { Harness } from './harness';
import { PairingError, type Pairing } from './pairing';
import { triggerIssues, type Scheduler } from './scheduler';
import type { BrotMcpService } from './mcp/types';
import type { LlmRelay, ProviderSpec } from './llm';
import { botBrowserKind } from './browser/tools';
import { BrowserError } from './browser/service';
import type { HostBrowserService } from './browser/types';
import { mountAttachmentRoutes, type AttachmentStorage } from './attachments';
import { mountTeamPackageRoutes } from './team-packages';
import { mountTodayRoutes } from './today';
import { mountUsageRoutes } from './usage';
import { mountDesktopRoutes, type DesktopService } from './desktop';
import { testMcpServer } from './mcp-servers';
import { RuleViolation } from './rooms/errors';
import type { RoomService } from './rooms/service';
import type { TaskService } from './rooms/tasks';
import { normalizeBase32 } from './browser/totp';
import { savedLoginSecretNames, SecretBody, SecretName, type Vault } from './vault';

export const SERVER_VERSION = '0.1.0';

const ALLOWED_ORIGINS = ['http://localhost:5199', 'http://127.0.0.1:5199'];
const REPLAY_PAGE_SIZE = 500;
const HEARTBEAT_MS = 15_000;
const DEFAULT_THREAD_TITLE = 'New thread';
const MAX_AUTO_TITLE_LENGTH = 80;
const ROUTINE_RUN_LIMIT_DEFAULT = 50;
const ROUTINE_RUN_LIMIT_MAX = 200;
const NOTIFICATION_LIMIT_DEFAULT = 50;
const NOTIFICATION_LIMIT_MAX = 200;

export interface AppDeps {
  repos: Repos;
  bus: EventBus;
  broker: Broker;
  harness: Harness;
  scheduler: Scheduler;
  vault: Vault;
  pairing: Pairing;
  engines: EngineRegistry;
  rooms: RoomService;
  tasks: TaskService;
  config: { host: string; port: number; mode: 'desktop' | 'server' };
  /** Treat loopback callers as the local user. Tests pass false to simulate a remote caller. Defaults to true. */
  trustLoopback?: boolean;
  /** The Brot MCP server. Its route authenticates each run's own token and is mounted outside `/api/*`. */
  mcp?: Pick<BrotMcpService, 'route'>;
  /** The model relay. Its route authenticates each run's own token and is mounted outside `/api/*`. */
  llm?: Pick<LlmRelay, 'route'>;
  /** The bot desktop service. Absent when no sandbox computer provider is configured: the desktop routes are then not mounted. */
  desktop?: DesktopService;
  /** The bot browser on the server machine, for bots with `browser: true` and no desktop computer. */
  browser: HostBrowserService;
  /** Attachment bytes under `<home>/attachments`. Only ids reach the API; no path does. */
  attachments: AttachmentStorage;
  /** The model providers the relay knows (seeded plus providers.json). Listed by GET /api/providers. */
  providers?: readonly ProviderSpec[];
  /** Clock the usage range defaults read. Tests inject a fixed time. */
  now?: () => Date;
}

type Parsed<T> = { ok: true; data: T } | { ok: false; response: Response };

function invalid(c: Context<AppEnv>, error: z.ZodError): Response {
  return c.json({ error: 'Invalid request', issues: error.issues }, 400);
}

async function parseBody<T>(c: Context<AppEnv>, schema: z.ZodType<T>): Promise<Parsed<T>> {
  const text = await c.req.text();
  let raw: unknown = {};
  if (text.trim() !== '') {
    try {
      raw = JSON.parse(text);
    } catch {
      return { ok: false, response: c.json({ error: 'Request body must be valid JSON', issues: [] }, 400) };
    }
  }
  const result = schema.safeParse(raw);
  if (!result.success) return { ok: false, response: invalid(c, result.error) };
  return { ok: true, data: result.data };
}

/** `host` computers run uncontained, so only the desktop app, where the user is at the machine, offers them. */
function hostRefused(c: Context<AppEnv>): Response {
  return c.json({ error: 'computer "host" is only available in the desktop app', issues: [] }, 400);
}

function notFound(c: Context<AppEnv>, what: string): Response {
  return c.json({ error: `${what} not found` }, 404);
}

function isValidPattern(pattern: string): boolean {
  try {
    RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

/** Parses a list limit: `fallback` when absent, clamped to `max`. Undefined for anything but a positive integer. */
function listLimit(raw: string | undefined, fallback: number, max: number): number | undefined {
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) return undefined;
  const limit = Number(raw);
  return limit < 1 ? undefined : Math.min(limit, max);
}

/** A webhook routine created without a secret gets an unguessable one, since the secret is its only credential. */
function withWebhookSecret(trigger: RoutineTrigger): RoutineTrigger {
  if (trigger.type === 'webhook' && trigger.secret === '') {
    return { type: 'webhook', secret: randomBytes(24).toString('base64url') };
  }
  return trigger;
}

async function attempt<T>(task: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await task();
  } catch {
    return fallback;
  }
}

/** Ids that name no bot, or an archived one, so they cannot join a room or take a task. */
async function unknownBots(repos: Repos, ids: readonly string[]): Promise<string[]> {
  const missing: string[] = [];
  for (const id of new Set(ids)) {
    const bot = await repos.bots.get(id);
    if (!bot || bot.archived) missing.push(id);
  }
  return missing;
}

/**
 * Why a message may not link these attachment ids: an id names nothing, an attachment belongs to another
 * thread, or one is already linked to a message.
 */
async function attachmentLinkIssues(
  repos: Repos,
  threadId: string,
  ids: readonly string[],
): Promise<Array<{ path: string[]; message: string }>> {
  if (ids.length === 0) return [];
  const stored = new Map(
    (await repos.attachments.listByIds([...new Set(ids)])).map((attachment) => [attachment.id, attachment]),
  );
  const issues: Array<{ path: string[]; message: string }> = [];
  for (const [index, id] of ids.entries()) {
    const attachment = stored.get(id);
    if (attachment === undefined) {
      issues.push({ path: ['attachmentIds', String(index)], message: 'unknown attachment' });
    } else if (attachment.threadId !== threadId) {
      issues.push({ path: ['attachmentIds', String(index)], message: 'this attachment belongs to another thread' });
    } else if (attachment.messageId !== undefined) {
      issues.push({ path: ['attachmentIds', String(index)], message: 'this attachment is already linked to a message' });
    }
  }
  return issues;
}

function invalidReference(c: Context<AppEnv>, path: string, message: string): Response {
  return c.json({ error: 'Invalid request', issues: [{ path: [path], message }] }, 400);
}

/** The id when it names no browser profile, for a 400 issue. Absent and `null` mean the bot's own profile. */
async function unknownBrowserProfile(repos: Repos, id: string | null | undefined): Promise<string | undefined> {
  if (id === undefined || id === null) return undefined;
  return (await repos.browserProfiles.get(id)) === undefined ? id : undefined;
}

/** Deletes a saved login's three vault values. The names derive from the id, so no row is needed. */
async function dropSavedLoginSecrets(vault: Vault, loginId: string): Promise<void> {
  const names = savedLoginSecretNames(loginId);
  await Promise.all([vault.delete(names.username), vault.delete(names.password), vault.delete(names.totp)]);
}

/** Which profile serves a bot's host browser: its own, or the shared profile it names. */
async function browserProfileRef(repos: Repos, bot: Bot): Promise<BrowserProfileRef> {
  if (bot.browserProfileId === undefined) return { kind: 'own' };
  const profile = await repos.browserProfiles.get(bot.browserProfileId);
  return { kind: 'shared', id: bot.browserProfileId, name: profile?.name ?? bot.browserProfileId };
}

/**
 * The title a default-titled thread takes from its first user message: the content's first line, trimmed and
 * cut to 80 code units. A surrogate pair at the edge is dropped whole instead of leaving half a code point.
 */
function titleFromMessage(content: string): string {
  const line = (content.split('\n')[0] ?? '').trim();
  const clipped = line.slice(0, MAX_AUTO_TITLE_LENGTH);
  const last = clipped.charCodeAt(clipped.length - 1);
  const cutsPair = clipped.length === MAX_AUTO_TITLE_LENGTH && last >= 0xd800 && last <= 0xdbff;
  return cutsPair ? clipped.slice(0, -1) : clipped;
}

function hasDefaultTitle(thread: Thread): boolean {
  const title = thread.title.trim();
  return title === '' || title === DEFAULT_THREAD_TITLE;
}

/** A team rule (depth, chain size, room size, ended task) answers 409. Any other error is a server error. */
function ruleViolation(c: Context<AppEnv>, error: unknown): Response {
  if (error instanceof RuleViolation) return c.json({ error: error.message }, 409);
  throw error;
}

export function createApp(deps: AppDeps): Hono<AppEnv> {
  const { repos, bus, broker, harness, scheduler, vault, pairing, engines, rooms, tasks, config, browser, attachments } = deps;
  const trustLoopback = deps.trustLoopback ?? true;
  const app = new Hono<AppEnv>();

  app.use('/api/*', cors({ origin: ALLOWED_ORIGINS, allowHeaders: ['Authorization', 'Content-Type'] }));
  // Every state-changing call is JSON, which forces a CORS preflight; the attachment upload alone speaks multipart.
  const jsonWrites = requireJsonWrites();
  app.use('/api/*', async (c, next) => {
    if (c.req.method === 'POST' && c.req.path === '/api/attachments') return next();
    return jsonWrites(c, next);
  });
  app.use('/api/*', authenticate({ devices: repos.devices, trustLoopback }));

  app.onError((error, c) => {
    console.error(error);
    return c.json({ error: 'Internal server error' }, 500);
  });
  app.notFound((c) => c.json({ error: 'Not found' }, 404));

  app.get('/api/health', (c) => c.json({ ok: true, version: SERVER_VERSION, protocol: PROTOCOL_VERSION }));

  app.get('/api/engines', async (c) => {
    const result = await Promise.all(
      engines.list().map(async (driver) => ({
        id: driver.id,
        label: driver.label,
        availability: await attempt(() => driver.detect(), { available: false, reason: 'Detection failed' }),
        models: await attempt(() => driver.models(), []),
      })),
    );
    return c.json(result);
  });

  app.get('/api/bots', async (c) =>
    c.json(await repos.bots.list({ includeArchived: c.req.query('includeArchived') === 'true' })),
  );

  /** Shared browser profiles: one signed-in Chrome on the server machine that several bots can use. */
  app.get('/api/browser/profiles', async (c) => c.json(await repos.browserProfiles.list()));

  app.post('/api/browser/profiles', async (c) => {
    const body = await parseBody(c, CreateBrowserProfile);
    if (!body.ok) return body.response;
    return c.json(await repos.browserProfiles.create(body.data), 201);
  });

  app.patch('/api/browser/profiles/:id', async (c) => {
    const id = c.req.param('id');
    if ((await repos.browserProfiles.get(id)) === undefined) return notFound(c, 'Browser profile');
    const body = await parseBody(c, UpdateBrowserProfile);
    if (!body.ok) return body.response;
    const profile = await repos.browserProfiles.update(id, body.data);
    return profile === undefined ? notFound(c, 'Browser profile') : c.json(profile);
  });

  /**
   * Deletes a shared profile: its browser closes, its saved logins directory goes, and every bot that named it
   * falls back to its own profile. The bots themselves are untouched.
   */
  app.delete('/api/browser/profiles/:id', async (c) => {
    const id = c.req.param('id');
    if ((await repos.browserProfiles.get(id)) === undefined) return notFound(c, 'Browser profile');
    await browser.closeProfile(id);
    await browser.deleteProfileDir(id);
    await repos.browserProfiles.remove(id);
    return c.body(null, 204);
  });

  app.post('/api/bots', async (c) => {
    const body = await parseBody(c, CreateBot);
    if (!body.ok) return body.response;
    if (body.data.computer === 'host' && config.mode !== 'desktop') return hostRefused(c);
    const missingProfile = await unknownBrowserProfile(repos, body.data.browserProfileId);
    if (missingProfile !== undefined) return invalidReference(c, 'browserProfileId', 'unknown browser profile');
    return c.json(await repos.bots.create(body.data), 201);
  });

  app.get('/api/bots/:id', async (c) => {
    const bot = await repos.bots.get(c.req.param('id'));
    return bot ? c.json(bot) : notFound(c, 'Bot');
  });

  app.patch('/api/bots/:id', async (c) => {
    const body = await parseBody(c, UpdateBot);
    if (!body.ok) return body.response;
    if (body.data.computer === 'host' && config.mode !== 'desktop') return hostRefused(c);
    const missingProfile = await unknownBrowserProfile(repos, body.data.browserProfileId);
    if (missingProfile !== undefined) return invalidReference(c, 'browserProfileId', 'unknown browser profile');
    const before = await repos.bots.get(c.req.param('id'));
    const bot = await repos.bots.update(c.req.param('id'), body.data);
    if (bot && before && bot.engine !== before.engine) await harness.resetEngineSessions(bot.id);
    return bot ? c.json(bot) : notFound(c, 'Bot');
  });

  app.delete('/api/bots/:id', async (c) => {
    const id = c.req.param('id');
    const bot = await repos.bots.get(id);
    if (!bot) return notFound(c, 'Bot');
    await harness.cancelBotRuns(id);
    // The profile holds the bot's logins, so it goes with the bot; closing first releases Chrome's lock.
    await browser.deleteProfile(bot);
    await repos.bots.remove(id);
    await scheduler.sync();
    return c.body(null, 204);
  });

  /** What the bot's browser on the server machine is doing. A bot without `browser: true` has none. */
  app.get('/api/bots/:id/browser', async (c) => {
    const bot = await repos.bots.get(c.req.param('id'));
    if (!bot) return notFound(c, 'Bot');
    if (bot.browser !== true) return c.json({ error: 'This bot has no browser' }, 409);
    const status = await browser.status(bot);
    return c.json({ state: status.state, profile: await browserProfileRef(repos, bot) });
  });

  /**
   * Opens a headed window on the server machine so the person can sign in, and leaves it open. The profile keeps
   * the session for the bot's own runs. A desktop sandbox bot already has a browser in its computer.
   */
  app.post('/api/bots/:id/browser/login', async (c) => {
    const bot = await repos.bots.get(c.req.param('id'));
    if (!bot) return notFound(c, 'Bot');
    if (bot.browser !== true) return c.json({ error: 'This bot has no browser' }, 409);
    if (botBrowserKind(bot) === 'desktop') {
      return c.json({ error: 'This bot already has a browser in its desktop' }, 409);
    }
    const status = await browser.openForLogin(bot);
    return c.json({ state: status.state, profile: await browserProfileRef(repos, bot) }, 202);
  });

  /**
   * Closes the bot's browser and saves its profile. For a shared profile this affects every bot using it.
   * Closing a browser that is already stopped is not an error.
   */
  app.post('/api/bots/:id/browser/close', async (c) => {
    const bot = await repos.bots.get(c.req.param('id'));
    if (!bot) return notFound(c, 'Bot');
    if (bot.browser !== true) return c.json({ error: 'This bot has no browser' }, 409);
    await browser.close(bot);
    return c.body(null, 204);
  });

  /**
   * Runs a host-browser route for a bot that opted in. The service reports its own conflicts through
   * `BrowserError`: 409 while the person is signing in, during a takeover, or when the browser cannot start.
   */
  async function withBrowserBot(c: Context<AppEnv>, run: (bot: Bot) => Promise<Response>): Promise<Response> {
    const bot = await repos.bots.get(c.req.param('id') ?? '');
    if (!bot) return notFound(c, 'Bot');
    if (bot.browser !== true) return c.json({ error: 'This bot has no browser' }, 409);
    try {
      return await run(bot);
    } catch (error) {
      if (error instanceof BrowserError) return c.json({ error: error.message }, error.status);
      throw error;
    }
  }

  /** A frame of the bot's browser for the live view. Opening the panel starts the browser. */
  app.get('/api/bots/:id/browser/screen', (c) =>
    withBrowserBot(c, async (bot) => {
      const jpeg = await browser.browserScreen(bot);
      const body = new Uint8Array(jpeg.byteLength);
      body.set(jpeg);
      return new Response(body, {
        headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-store' },
      });
    }),
  );

  /** Who holds the bot's browser. A shared profile reports one state to every bot that uses it. */
  app.get('/api/bots/:id/browser/takeover', (c) =>
    withBrowserBot(c, async (bot) => c.json(await browser.browserTakeover(bot))),
  );

  /** Takes or hands back control of the browser. Writing needs a full device, like the computer takeover. */
  app.post('/api/bots/:id/browser/takeover', (c) =>
    withBrowserBot(c, async (bot) => {
      const body = await parseBody(c, SetBrowserTakeover);
      if (!body.ok) return body.response;
      return c.json(await browser.setBrowserTakeover(bot, body.data, 'user'));
    }),
  );

  /** One mouse or keyboard event from the person while they hold the browser. */
  app.post('/api/bots/:id/browser/input', (c) =>
    withBrowserBot(c, async (bot) => {
      const body = await parseBody(c, ComputerInput);
      if (!body.ok) return body.response;
      await browser.browserInput(bot, body.data);
      return c.body(null, 204);
    }),
  );

  /** Without `kind`, every thread the bot owns (its DM, and rooms it leads). `kind=room` lists rooms it is a member of. */
  app.get('/api/bots/:id/threads', async (c) => {
    const id = c.req.param('id');
    if (!(await repos.bots.get(id))) return notFound(c, 'Bot');
    const kind = c.req.query('kind');
    if (kind === undefined) return c.json(await repos.threads.listByBot(id));
    const parsed = ThreadKind.safeParse(kind);
    if (!parsed.success) return invalid(c, parsed.error);
    if (parsed.data === 'room') return c.json(await rooms.listForBot(id));
    return c.json(await repos.threads.listByBot(id, { kind: 'dm' }));
  });

  app.post('/api/bots/:id/threads', async (c) => {
    const id = c.req.param('id');
    if (!(await repos.bots.get(id))) return notFound(c, 'Bot');
    const body = await parseBody(c, CreateThread);
    if (!body.ok) return body.response;
    return c.json(await repos.threads.create(id, body.data), 201);
  });

  app.patch('/api/threads/:id', async (c) => {
    const id = c.req.param('id');
    if (!(await repos.threads.get(id))) return notFound(c, 'Thread');
    const body = await parseBody(c, UpdateThread);
    if (!body.ok) return body.response;
    const thread = await repos.threads.setTitle(id, body.data.title);
    return thread ? c.json(thread) : notFound(c, 'Thread');
  });

  app.get('/api/threads/:id/messages', async (c) => {
    const id = c.req.param('id');
    if (!(await repos.threads.get(id))) return notFound(c, 'Thread');
    return c.json(await repos.messages.listByThread(id));
  });

  app.get('/api/threads/:id/runs', async (c) => {
    const id = c.req.param('id');
    if (!(await repos.threads.get(id))) return notFound(c, 'Thread');
    return c.json(await repos.runs.listByThread(id));
  });

  /**
   * Stores the user message and starts the answer. In a room the responders run one after another and `runId`
   * is the first one's (null when nobody answers). The persisted message is returned with its attachments.
   */
  app.post('/api/threads/:id/messages', async (c) => {
    const id = c.req.param('id');
    const thread = await repos.threads.get(id);
    if (!thread) return notFound(c, 'Thread');
    const body = await parseBody(c, PostMessage);
    if (!body.ok) return body.response;
    if (hasDefaultTitle(thread)) {
      const title = titleFromMessage(body.data.content);
      if (title !== '') await repos.threads.setTitle(id, title);
    }
    const attachmentIssues = await attachmentLinkIssues(repos, thread.id, body.data.attachmentIds ?? []);
    if (attachmentIssues.length > 0) return c.json({ error: 'Invalid request', issues: attachmentIssues }, 400);
    if (thread.kind === 'room') {
      const { runId, message } = await rooms.post(thread, body.data);
      return c.json({ runId, message }, 202);
    }
    const { runId, message } = await harness.startRun(id, body.data.content, body.data.attachmentIds);
    return c.json({ runId, message }, 202);
  });

  /** The log in order. Without `after`, the first page; with it, the page of events that follow that event id. */
  app.get('/api/threads/:id/events', async (c) => {
    const id = c.req.param('id');
    if (!(await repos.threads.get(id))) return notFound(c, 'Thread');
    const after = c.req.query('after');
    if (after === undefined) return c.json(await repos.events.list({ threadId: id, limit: REPLAY_PAGE_SIZE }));
    const events = await repos.events.listAfter(id, after, { limit: REPLAY_PAGE_SIZE });
    return events ? c.json(events) : notFound(c, 'Event');
  });

  app.post('/api/rooms', async (c) => {
    const body = await parseBody(c, CreateRoom);
    if (!body.ok) return body.response;
    const missing = await unknownBots(repos, body.data.botIds);
    if (missing.length > 0) return invalidReference(c, 'botIds', `unknown or archived bots: ${missing.join(', ')}`);
    return c.json(await rooms.create(body.data), 201);
  });

  app.get('/api/rooms', async (c) => c.json(await rooms.list()));

  app.get('/api/rooms/:id/members', async (c) => {
    const members = await rooms.members(c.req.param('id'));
    return members ? c.json(members) : notFound(c, 'Room');
  });

  app.patch('/api/rooms/:id/members', async (c) => {
    const id = c.req.param('id');
    if (!(await rooms.members(id))) return notFound(c, 'Room');
    const body = await parseBody(c, UpdateRoomMembers);
    if (!body.ok) return body.response;
    const missing = await unknownBots(repos, body.data.add ?? []);
    if (missing.length > 0) return invalidReference(c, 'add', `unknown or archived bots: ${missing.join(', ')}`);
    try {
      const members = await rooms.updateMembers(id, body.data);
      return members ? c.json(members) : notFound(c, 'Room');
    } catch (error) {
      return ruleViolation(c, error);
    }
  });

  app.get('/api/teams', async (c) => c.json(await repos.teams.list()));

  app.post('/api/teams', async (c) => {
    const body = await parseBody(c, CreateTeam);
    if (!body.ok) return body.response;
    if (body.data.chiefBotId !== undefined) {
      const missing = await unknownBots(repos, [body.data.chiefBotId]);
      if (missing.length > 0) {
        return invalidReference(c, 'chiefBotId', `unknown or archived bots: ${missing.join(', ')}`);
      }
    }
    return c.json(await repos.teams.create(body.data), 201);
  });

  /** Updates a team. `chiefBotId: null` removes the chief. */
  app.patch('/api/teams/:id', async (c) => {
    const id = c.req.param('id');
    if (!(await repos.teams.get(id))) return notFound(c, 'Team');
    const body = await parseBody(c, UpdateTeam);
    if (!body.ok) return body.response;
    const chiefBotId = body.data.chiefBotId;
    if (chiefBotId !== undefined && chiefBotId !== null) {
      const missing = await unknownBots(repos, [chiefBotId]);
      if (missing.length > 0) {
        return invalidReference(c, 'chiefBotId', `unknown or archived bots: ${missing.join(', ')}`);
      }
    }
    const team = await repos.teams.update(id, body.data);
    return team ? c.json(team) : notFound(c, 'Team');
  });

  /** Deletes the team and ungroups its bots. The bots stay. */
  app.delete('/api/teams/:id', async (c) =>
    (await repos.teams.remove(c.req.param('id'))) ? c.body(null, 204) : notFound(c, 'Team'),
  );

  app.get('/api/tasks', async (c) => {
    const filter: TaskFilter = {};
    const assigneeBotId = c.req.query('assigneeBotId');
    const chainId = c.req.query('chainId');
    const threadId = c.req.query('threadId');
    if (assigneeBotId) filter.assigneeBotId = assigneeBotId;
    if (chainId) filter.chainId = chainId;
    if (threadId) filter.threadId = threadId;
    const status = c.req.query('status');
    if (status !== undefined) {
      const parsed = TaskStatus.safeParse(status);
      if (!parsed.success) return invalid(c, parsed.error);
      filter.status = parsed.data;
    }
    return c.json(await tasks.list(filter));
  });

  /** A user's task is depth 0. A body that names `createdByBotId` is a delegation, and goes one level deeper. */
  app.post('/api/tasks', async (c) => {
    const body = await parseBody(c, CreateTask);
    if (!body.ok) return body.response;
    const data = body.data;
    const issues: Array<{ path: string[]; message: string }> = [];
    const assignee = await repos.bots.get(data.assigneeBotId);
    if (!assignee || assignee.archived) issues.push({ path: ['assigneeBotId'], message: 'unknown or archived bot' });
    if (data.createdByBotId !== undefined && !(await repos.bots.get(data.createdByBotId))) {
      issues.push({ path: ['createdByBotId'], message: 'unknown bot' });
    }
    if (!(await repos.threads.get(data.threadId))) issues.push({ path: ['threadId'], message: 'unknown thread' });
    if (data.parentTaskId !== undefined && !(await repos.tasks.get(data.parentTaskId))) {
      issues.push({ path: ['parentTaskId'], message: 'unknown task' });
    }
    if (issues.length > 0) return c.json({ error: 'Invalid request', issues }, 400);
    try {
      return c.json(await tasks.create(data), 201);
    } catch (error) {
      return ruleViolation(c, error);
    }
  });

  app.get('/api/tasks/:id', async (c) => {
    const task = await tasks.get(c.req.param('id'));
    return task ? c.json(task) : notFound(c, 'Task');
  });

  app.patch('/api/tasks/:id', async (c) => {
    const body = await parseBody(c, UpdateTask);
    if (!body.ok) return body.response;
    try {
      const task = await tasks.update(c.req.param('id'), body.data);
      return task ? c.json(task) : notFound(c, 'Task');
    } catch (error) {
      return ruleViolation(c, error);
    }
  });

  app.post('/api/runs/:id/cancel', async (c) => {
    const run = await harness.cancelRun(c.req.param('id'));
    return run ? c.json(run) : notFound(c, 'Run');
  });

  app.get('/api/approvals', async (c) => {
    const status = c.req.query('status');
    if (status === undefined) return c.json(await repos.approvals.list());
    const parsed = ApprovalStatus.safeParse(status);
    if (!parsed.success) return invalid(c, parsed.error);
    return c.json(await repos.approvals.list({ status: parsed.data }));
  });

  app.post('/api/approvals/:id', async (c) => {
    const body = await parseBody(c, ResolveApproval);
    if (!body.ok) return body.response;
    const approval = await broker.resolve(c.req.param('id'), body.data.decision, body.data.reply);
    return approval ? c.json(approval) : notFound(c, 'Approval');
  });

  // Notification inbox: approvals, finished runs and failures recorded by the notifications service.

  app.get('/api/notifications', async (c) => {
    const unread = c.req.query('unread');
    if (unread !== undefined && unread !== 'true' && unread !== 'false') {
      return c.json({ error: 'unread must be true or false' }, 400);
    }
    const limit = listLimit(c.req.query('limit'), NOTIFICATION_LIMIT_DEFAULT, NOTIFICATION_LIMIT_MAX);
    if (limit === undefined) return c.json({ error: 'limit must be a positive integer' }, 400);
    const botId = c.req.query('botId');
    return c.json(
      await repos.notifications.list({
        ...(unread === 'true' ? { unread: true } : {}),
        ...(botId === undefined || botId === '' ? {} : { botId }),
        limit,
      }),
    );
  });

  app.get('/api/notifications/unread-count', async (c) => c.json({ count: await repos.notifications.countUnread() }));

  /** Marks notifications read. An empty body marks every unread notification. */
  app.post('/api/notifications/read', async (c) => {
    const body = await parseBody(c, MarkNotificationsRead);
    if (!body.ok) return body.response;
    return c.json({ updated: await repos.notifications.markRead(body.data.ids) });
  });

  app.delete('/api/notifications/:id', async (c) =>
    (await repos.notifications.remove(c.req.param('id'))) ? c.body(null, 204) : notFound(c, 'Notification'),
  );

  app.get('/api/bots/:id/policies', async (c) => {
    const id = c.req.param('id');
    if (!(await repos.bots.get(id))) return notFound(c, 'Bot');
    return c.json(await repos.policies.listByBot(id));
  });

  app.post('/api/bots/:id/policies', async (c) => {
    const id = c.req.param('id');
    if (!(await repos.bots.get(id))) return notFound(c, 'Bot');
    const body = await parseBody(c, CreatePolicy);
    if (!body.ok) return body.response;
    if (body.data.argPattern !== undefined && !isValidPattern(body.data.argPattern)) {
      return c.json(
        { error: 'Invalid request', issues: [{ path: ['argPattern'], message: 'argPattern must be a valid regular expression' }] },
        400,
      );
    }
    return c.json(await repos.policies.create(id, body.data), 201);
  });

  app.delete('/api/policies/:id', async (c) =>
    (await repos.policies.remove(c.req.param('id'))) ? c.body(null, 204) : notFound(c, 'Policy'),
  );

  app.get('/api/bots/:id/memories', async (c) => {
    const id = c.req.param('id');
    if (!(await repos.bots.get(id))) return notFound(c, 'Bot');
    return c.json(await repos.memories.listByBot(id));
  });

  app.post('/api/bots/:id/memories', async (c) => {
    const id = c.req.param('id');
    if (!(await repos.bots.get(id))) return notFound(c, 'Bot');
    const body = await parseBody(c, CreateMemory);
    if (!body.ok) return body.response;
    return c.json(await repos.memories.create(id, body.data), 201);
  });

  app.patch('/api/memories/:id', async (c) => {
    const body = await parseBody(c, UpdateMemory);
    if (!body.ok) return body.response;
    const memory = await repos.memories.update(c.req.param('id'), body.data);
    return memory ? c.json(memory) : notFound(c, 'Memory');
  });

  app.delete('/api/memories/:id', async (c) =>
    (await repos.memories.remove(c.req.param('id'))) ? c.body(null, 204) : notFound(c, 'Memory'),
  );

  app.get('/api/skills', async (c) => {
    const botId = c.req.query('botId');
    return c.json(botId ? await repos.skills.listForBot(botId) : await repos.skills.list());
  });

  app.post('/api/skills', async (c) => {
    const body = await parseBody(c, CreateSkill);
    if (!body.ok) return body.response;
    if (body.data.botId !== undefined && !(await repos.bots.get(body.data.botId))) return notFound(c, 'Bot');
    return c.json(await repos.skills.create(body.data), 201);
  });

  app.patch('/api/skills/:id', async (c) => {
    const body = await parseBody(c, UpdateSkill);
    if (!body.ok) return body.response;
    const skill = await repos.skills.update(c.req.param('id'), body.data);
    return skill ? c.json(skill) : notFound(c, 'Skill');
  });

  app.delete('/api/skills/:id', async (c) =>
    (await repos.skills.remove(c.req.param('id'))) ? c.body(null, 204) : notFound(c, 'Skill'),
  );

  // User MCP servers: stored configuration that runs receive next to the Brot MCP server. Env values may be
  // `secret://` references; they are returned as references and resolved only into a child process.

  app.get('/api/mcp/servers', async (c) => c.json(await repos.mcpServers.list()));

  app.post('/api/mcp/servers', async (c) => {
    const body = await parseBody(c, CreateMcpServer);
    if (!body.ok) return body.response;
    if ((await repos.mcpServers.list()).some((server) => server.name === body.data.name)) {
      return c.json(
        { error: 'Invalid request', issues: [{ path: ['name'], message: 'an MCP server with that name already exists' }] },
        400,
      );
    }
    return c.json(await repos.mcpServers.create(body.data), 201);
  });

  app.patch('/api/mcp/servers/:id', async (c) => {
    const id = c.req.param('id');
    const current = await repos.mcpServers.get(id);
    if (!current) return notFound(c, 'MCP server');
    const body = await parseBody(c, UpdateMcpServer);
    if (!body.ok) return body.response;
    const renamed = body.data.name;
    if (
      renamed !== undefined &&
      renamed !== current.name &&
      (await repos.mcpServers.list()).some((server) => server.name === renamed)
    ) {
      return c.json(
        { error: 'Invalid request', issues: [{ path: ['name'], message: 'an MCP server with that name already exists' }] },
        400,
      );
    }
    try {
      const updated = await repos.mcpServers.update(id, body.data);
      return updated ? c.json(updated) : notFound(c, 'MCP server');
    } catch (error) {
      // The patch merged with the stored server can break the transport's required field.
      if (error instanceof z.ZodError) return invalid(c, error);
      throw error;
    }
  });

  app.delete('/api/mcp/servers/:id', async (c) =>
    (await repos.mcpServers.remove(c.req.param('id'))) ? c.body(null, 204) : notFound(c, 'MCP server'),
  );

  /** Tests the handshake the way a run's engine would make it. A failed handshake is a 200 with `ok: false`. */
  app.post('/api/mcp/servers/:id/test', async (c) => {
    const server = await repos.mcpServers.get(c.req.param('id'));
    if (!server) return notFound(c, 'MCP server');
    return c.json(await testMcpServer(server, { vault }));
  });

  app.get('/api/routines', async (c) => c.json(await repos.routines.list({ botId: c.req.query('botId') })));

  app.post('/api/routines', async (c) => {
    const body = await parseBody(c, CreateRoutine);
    if (!body.ok) return body.response;
    if (!(await repos.bots.get(body.data.botId))) return notFound(c, 'Bot');
    const issues = triggerIssues(body.data.trigger);
    if (issues.length > 0) return c.json({ error: 'Invalid request', issues }, 400);
    const routine = await repos.routines.create({ ...body.data, trigger: withWebhookSecret(body.data.trigger) });
    await scheduler.sync();
    return c.json((await repos.routines.get(routine.id)) ?? routine, 201);
  });

  app.patch('/api/routines/:id', async (c) => {
    const id = c.req.param('id');
    if (!(await repos.routines.get(id))) return notFound(c, 'Routine');
    const body = await parseBody(c, UpdateRoutine);
    if (!body.ok) return body.response;
    if (body.data.trigger) {
      const issues = triggerIssues(body.data.trigger);
      if (issues.length > 0) return c.json({ error: 'Invalid request', issues }, 400);
    }
    const trigger = body.data.trigger && withWebhookSecret(body.data.trigger);
    await repos.routines.update(id, { ...body.data, trigger });
    await scheduler.sync();
    const routine = await repos.routines.get(id);
    return routine ? c.json(routine) : notFound(c, 'Routine');
  });

  app.delete('/api/routines/:id', async (c) => {
    const removed = await repos.routines.remove(c.req.param('id'));
    if (!removed) return notFound(c, 'Routine');
    await scheduler.sync();
    return c.body(null, 204);
  });

  app.post('/api/routines/:id/run', async (c) => {
    const result = await scheduler.runRoutineNow(c.req.param('id'));
    if (!result) return notFound(c, 'Routine');
    if (result.status === 'skipped') return c.json({ error: 'Routine is already running' }, 409);
    return c.json({ runId: result.runId }, 202);
  });

  /** A routine's run history, newest first. */
  app.get('/api/routines/:id/runs', async (c) => {
    const id = c.req.param('id');
    if (!(await repos.routines.get(id))) return notFound(c, 'Routine');
    const limit = listLimit(c.req.query('limit'), ROUTINE_RUN_LIMIT_DEFAULT, ROUTINE_RUN_LIMIT_MAX);
    if (limit === undefined) return c.json({ error: 'limit must be a positive integer' }, 400);
    return c.json(await repos.routineRuns.listByRoutine(id, { limit }));
  });

  /** Run history across routines, filtered by routine, bot, or status. Newest first. */
  app.get('/api/routine-runs', async (c) => {
    const limit = listLimit(c.req.query('limit'), ROUTINE_RUN_LIMIT_DEFAULT, ROUTINE_RUN_LIMIT_MAX);
    if (limit === undefined) return c.json({ error: 'limit must be a positive integer' }, 400);
    const status = c.req.query('status');
    const parsed = status === undefined ? undefined : RoutineRunStatus.safeParse(status);
    if (parsed !== undefined && !parsed.success) return invalid(c, parsed.error);
    const routineId = c.req.query('routineId');
    const botId = c.req.query('botId');
    return c.json(
      await repos.routineRuns.list({
        ...(routineId === undefined ? {} : { routineId }),
        ...(botId === undefined ? {} : { botId }),
        ...(parsed?.success === true ? { status: parsed.data } : {}),
        limit,
      }),
    );
  });

  // Live events: replays stored events after `after` (when given), then streams live ones.

  app.get('/api/events', (c) => {
    const threadId = c.req.query('threadId') || undefined;
    const after = c.req.query('after');
    if (after !== undefined && !IsoDateTime.safeParse(after).success) {
      return c.json({ error: 'after must be an ISO timestamp' }, 400);
    }
    return streamSSE(c, async (stream) => {
      let writes: Promise<unknown> = Promise.resolve();
      const enqueue = (task: () => Promise<unknown>): void => {
        writes = writes.then(task).catch(() => undefined);
      };
      const sendEvent = (event: CanonicalEvent): void => {
        enqueue(() => stream.writeSSE({ id: event.id, event: event.type, data: JSON.stringify(event) }));
      };

      let finish: () => void = () => undefined;
      const closed = new Promise<void>((resolve) => {
        finish = resolve;
      });

      // Subscribe before replaying so that no event falls between the replay snapshot and the live stream.
      let replaying = after !== undefined;
      const buffered: CanonicalEvent[] = [];
      const seen = new Set<string>();
      const unsubscribe = bus.subscribe(
        (event) => {
          if (replaying) buffered.push(event);
          else sendEvent(event);
        },
        { threadId },
      );
      const heartbeat = setInterval(() => enqueue(() => stream.write(': keep-alive\n\n')), HEARTBEAT_MS);
      heartbeat.unref();
      stream.onAbort(() => {
        unsubscribe();
        clearInterval(heartbeat);
        finish();
      });

      if (after !== undefined) {
        let cursor = after;
        for (;;) {
          const page = await repos.events.list({ threadId, after: cursor, limit: REPLAY_PAGE_SIZE });
          for (const event of page) {
            seen.add(event.id);
            sendEvent(event);
          }
          const last = page.at(-1);
          if (page.length < REPLAY_PAGE_SIZE || !last) break;
          cursor = last.at;
        }
      }
      replaying = false;
      for (const event of buffered.splice(0)) {
        if (!seen.has(event.id)) sendEvent(event);
      }

      await closed;
    });
  });

  // Secrets: names only. Values are written here and never returned.

  app.get('/api/secrets', async (c) => c.json(await vault.list()));

  app.put('/api/secrets/:name', async (c) => {
    const name = SecretName.safeParse(c.req.param('name'));
    if (!name.success) return invalid(c, name.error);
    const body = await parseBody(c, SecretBody);
    if (!body.ok) return body.response;
    await vault.set(name.data, body.data.value);
    return c.json({ name: name.data });
  });

  app.delete('/api/secrets/:name', async (c) => {
    const name = SecretName.safeParse(c.req.param('name'));
    if (!name.success) return invalid(c, name.error);
    return (await vault.delete(name.data)) ? c.body(null, 204) : notFound(c, 'Secret');
  });

  /**
   * Saved logins. The username, password and TOTP secret are sealed in the vault; every response is the value-free
   * SavedLogin view, exactly like /api/secrets never returns a value.
   */
  app.get('/api/logins', async (c) => c.json(await repos.savedLogins.list()));

  app.post('/api/logins', async (c) => {
    const body = await parseBody(c, CreateSavedLogin);
    if (!body.ok) return body.response;
    if ((await repos.savedLogins.getByName(body.data.name)) !== undefined) {
      return invalidReference(c, 'name', 'a saved login with this name already exists');
    }
    const id = randomUUID();
    const names = savedLoginSecretNames(id);
    try {
      await vault.set(names.username, body.data.username);
      await vault.set(names.password, body.data.password);
      if (body.data.totp !== undefined) await vault.set(names.totp, normalizeBase32(body.data.totp));
    } catch (error) {
      await dropSavedLoginSecrets(vault, id);
      throw error;
    }
    try {
      return c.json(await repos.savedLogins.create(body.data, { id, secretNames: names }), 201);
    } catch (error) {
      await dropSavedLoginSecrets(vault, id);
      throw error;
    }
  });

  app.patch('/api/logins/:id', async (c) => {
    const id = c.req.param('id');
    const current = await repos.savedLogins.get(id);
    if (current === undefined) return notFound(c, 'Saved login');
    const body = await parseBody(c, UpdateSavedLogin);
    if (!body.ok) return body.response;
    if (body.data.name !== undefined && body.data.name !== current.name) {
      if ((await repos.savedLogins.getByName(body.data.name)) !== undefined) {
        return invalidReference(c, 'name', 'a saved login with this name already exists');
      }
    }
    const names = savedLoginSecretNames(id);
    if (body.data.username !== undefined) await vault.set(names.username, body.data.username);
    if (body.data.password !== undefined) await vault.set(names.password, body.data.password);
    if (body.data.totp === null) await vault.delete(names.totp);
    else if (body.data.totp !== undefined) await vault.set(names.totp, normalizeBase32(body.data.totp));
    const login = await repos.savedLogins.update(id, body.data, names);
    return login === undefined ? notFound(c, 'Saved login') : c.json(login);
  });

  app.delete('/api/logins/:id', async (c) => {
    const id = c.req.param('id');
    if ((await repos.savedLogins.get(id)) === undefined) return notFound(c, 'Saved login');
    await dropSavedLoginSecrets(vault, id);
    await repos.savedLogins.remove(id);
    return c.body(null, 204);
  });

  app.post('/api/pairing/start', (c) => {
    if (!isLocalRequest(c, trustLoopback)) {
      return c.json({ error: 'Pairing can only be started from this machine' }, 403);
    }
    return c.json(pairing.start({ host: config.host, port: config.port }), 201);
  });

  app.post('/api/pairing/complete', async (c) => {
    const body = await parseBody(c, PairingComplete);
    if (!body.ok) return body.response;
    try {
      return c.json(await pairing.complete(body.data), 201);
    } catch (error) {
      if (error instanceof PairingError) return c.json({ error: error.message }, error.status);
      throw error;
    }
  });

  app.get('/api/devices', async (c) => c.json(await repos.devices.list()));

  app.delete('/api/devices/:id', async (c) =>
    (await repos.devices.remove(c.req.param('id'))) ? c.body(null, 204) : notFound(c, 'Device'),
  );

  app.get('/api/providers', async (c) => {
    const listed = await Promise.all(
      (deps.providers ?? []).map(async (spec) => ({
        id: spec.id,
        label: spec.id,
        models: (spec.models ?? []).map((model) => ({ id: model.id, label: model.id })),
        configured: await vault.has(spec.secretName),
        secretName: spec.secretName,
      })),
    );
    return c.json(listed);
  });

  mountAttachmentRoutes(app, { repos, storage: attachments });

  mountUsageRoutes(app, { repos, ...(deps.now === undefined ? {} : { now: deps.now }) });

  mountTeamPackageRoutes(app, { repos, ...(deps.now === undefined ? {} : { now: deps.now }) });

  mountTodayRoutes(app, { repos, ...(deps.now === undefined ? {} : { now: deps.now }) });

  if (deps.desktop) mountDesktopRoutes(app, { repos, desktop: deps.desktop });

  if (deps.mcp) app.route('/', deps.mcp.route);
  if (deps.llm) app.route('/', deps.llm.route);

  return app;
}

import { createDb, createRepos, migrate, type BrotDb, type Repos } from '@brot/db';
import type { EngineRegistry } from '@brot/engines';
import { createAttachmentStorage, type AttachmentStorage } from './attachments';
import { createHostBrowserService } from './browser';
import { createBrowserTools } from './browser/tools';
import type { HostBrowserService } from './browser/types';
import { createBroker, type Broker } from './broker';
import { createEventBus, type EventBus } from './bus';
import type { ServerConfig } from './config';
import type { ComputerProvider } from './computers/types';
import { createDesktopService, createDesktopTools, createTakeoverState, type DesktopOptions, type DesktopService } from './desktop';
import { createHarness, type ComputerProviders, type Harness } from './harness';
import {
  createLlmRelay,
  createProviderRegistry,
  loadProviderFile,
  mergeProviders,
  SEEDED_PROVIDERS,
  type FetchLike,
  type LlmRelay,
  type ProviderSpec,
} from './llm';
import type { BrotMcpService, BrotTool } from './mcp/types';
import { createNotificationsService, type NotificationsService } from './notifications';
import { createPairing, type Pairing } from './pairing';
import { createChainLedger, readRoomChainBudgetUsd, type ChainLedger } from './rooms/chains';
import { createRoomDecider, type RoomDecider } from './rooms/decider';
import { createRoomService, type RoomService } from './rooms/service';
import { createTaskService, type TaskService } from './rooms/tasks';
import { createTeamRunner, type TeamRunnerService } from './rooms/team-runner';
import { createScheduler, type Scheduler } from './scheduler';
import type { TeamDeps } from './team/context';
import { createVault, type Vault } from './vault';

export type { ComputerProviders } from './harness';

/** The services a Brot MCP server is built from. They are created here, so the MCP shares this server's broker. */
export interface McpCore {
  repos: Repos;
  bus: EventBus;
  broker: Broker;
  vault: Vault;
  /** Team tools from `ServiceExtras.team`, registered next to the built-in ones. */
  tools: BrotTool[];
}

/** Model relay options. Providers here override the seeded ones and `providers.json` by id. */
export interface LlmOptions {
  providers?: ProviderSpec[];
  /** Outbound HTTP for the relay. Tests inject a fake upstream. */
  fetch?: FetchLike;
  /** Milliseconds until the provider must answer with headers. Defaults to two minutes. */
  responseTimeoutMs?: number;
  /** Milliseconds allowed between response body chunks once streaming. Defaults to two minutes. */
  streamStallTimeoutMs?: number;
  /** Milliseconds one relayed request may take in total. Defaults to fifteen minutes. */
  requestDeadlineMs?: number;
}

/** Optional contained-run services. Absent ones leave `computer: 'sandbox'` runs failing and `none` runs without MCP. */
export interface ServiceExtras {
  computers?: ComputerProviders;
  mcp?: (core: McpCore) => BrotMcpService;
  /** Team tools (`ask_bot`, `delegate_task`, `update_my_task`, `handoff`, `list_team`), registered on the Brot MCP server. */
  team?: (deps: TeamDeps) => BrotTool[];
  llm?: LlmOptions;
  /** Bot desktop options. Tests inject a fake runner here. Only used when a sandbox computer provider exists. */
  desktop?: DesktopOptions;
  /** The bot browser on the server machine. Tests inject a fake. Defaults to a Chrome per browser profile (own or shared). */
  browser?: HostBrowserService;
  /** Room decider options: the decider model call's outbound HTTP and timeout. Tests inject a fake upstream. */
  decider?: { fetch?: FetchLike; timeoutMs?: number };
}

export interface Services {
  config: ServerConfig;
  db: BrotDb;
  repos: Repos;
  engines: EngineRegistry;
  bus: EventBus;
  broker: Broker;
  harness: Harness;
  scheduler: Scheduler;
  vault: Vault;
  pairing: Pairing;
  computers: ComputerProviders;
  mcp: BrotMcpService | undefined;
  /** Bot desktops. Absent without a sandbox computer provider. */
  desktop: DesktopService | undefined;
  /** The bot browser on the server machine. Chrome starts on the first command, never at boot. */
  browser: HostBrowserService;
  /** Attachment bytes under `<home>/attachments`, reached by id only. */
  attachments: AttachmentStorage;
  /** The notification inbox: records approvals/finished runs/failures as the bus reports them. */
  notifications: NotificationsService;
  /** The providers the model relay knows, listed by GET /api/providers. */
  providers: ProviderSpec[];
  /** Relays contained runs' model requests to their providers, adding the key from the vault. */
  llm: LlmRelay;
  rooms: RoomService;
  /** Picks the answering bot for `auto` rooms, using the model stored under the `room-decider` setting. */
  roomDecider: RoomDecider;
  tasks: TaskService;
  teamRunner: TeamRunnerService;
  chains: ChainLedger;
  /** Stops the engines, the computer providers, the scheduler and the database. Safe to call twice. */
  close(): Promise<void>;
}

/** Opens the database, migrates it, and wires every service together. Does not seed or recover runs. */
export async function createServices(
  config: ServerConfig,
  engines: EngineRegistry,
  extras: ServiceExtras = {},
): Promise<Services> {
  const db = await createDb(config.dbUrl);
  await migrate(db.db);
  const repos = createRepos(db.db);
  const bus = createEventBus(repos.events);
  const broker = createBroker({ repos, bus });
  const notifications = createNotificationsService({ repos, bus });
  await notifications.prune();
  const vault = createVault({ dir: config.home });
  const attachments = createAttachmentStorage({ home: config.home });
  const computers = extras.computers ?? {};

  // The harness needs the MCP server, the MCP server needs the team tools, and the team tools need the
  // harness through the runner. The late reference breaks that cycle: nothing calls it before boot ends.
  const late: { harness?: Harness } = {};
  const currentHarness = (): Harness => {
    if (late.harness === undefined) throw new Error('the harness is not ready');
    return late.harness;
  };
  const providers = mergeProviders(
    SEEDED_PROVIDERS,
    await loadProviderFile(config.providersFile),
    extras.llm?.providers ?? [],
  );
  const providerRegistry = createProviderRegistry(providers);
  const llm = createLlmRelay({
    vault,
    providers: providerRegistry,
    ...(extras.llm?.fetch === undefined ? {} : { fetch: extras.llm.fetch }),
    ...(extras.llm?.responseTimeoutMs === undefined ? {} : { responseTimeoutMs: extras.llm.responseTimeoutMs }),
    ...(extras.llm?.streamStallTimeoutMs === undefined ? {} : { streamStallTimeoutMs: extras.llm.streamStallTimeoutMs }),
    ...(extras.llm?.requestDeadlineMs === undefined ? {} : { requestDeadlineMs: extras.llm.requestDeadlineMs }),
  });
  const roomDecider = createRoomDecider({
    repos,
    providers: providerRegistry,
    vault,
    ...(extras.decider === undefined ? {} : extras.decider),
  });
  const chains = createChainLedger({ roomBudgetUsd: readRoomChainBudgetUsd(process.env.BROT_TEAM_CHAIN_BUDGET_USD) });
  const rooms = createRoomService({ repos, bus, harness: currentHarness, decider: roomDecider });
  const teamRunner = createTeamRunner({ harness: currentHarness, chains });
  const tasks = createTaskService({ repos, bus, harness: currentHarness, runner: teamRunner });
  const teamTools =
    extras.team?.({
      repos,
      bus,
      runner: teamRunner,
      onHandoff: (threadId, toBotId) => rooms.setBaton(threadId, toBotId),
    }) ?? [];
  const desktop = computers.sandbox
    ? createDesktopService({
        provider: computers.sandbox,
        repos,
        bus,
        takeovers: createTakeoverState(),
        ...(extras.desktop ?? {}),
      })
    : undefined;
  const browser = extras.browser ?? createHostBrowserService({ home: config.home, settings: repos.settings });
  const browserTools = createBrowserTools({
    repos,
    host: browser,
    ...(desktop === undefined ? {} : { desktop, takeovers: desktop.takeovers }),
  });
  const desktopTools = desktop
    ? createDesktopTools({ repos, desktop, takeovers: desktop.takeovers, takeoverWaitMs: extras.desktop?.takeoverWaitMs })
    : [];
  const mcp = extras.mcp?.({ repos, bus, broker, vault, tools: [...teamTools, ...browserTools, ...desktopTools] });
  const harness = createHarness({
    repos,
    bus,
    broker,
    engines,
    computers,
    mcp,
    llm,
    vault,
    attachments,
    providers: providerRegistry,
    teamTools: teamTools.length > 0,
    mode: config.mode,
    computerImage: config.computerImage,
    loopbackUrl: () => `http://127.0.0.1:${config.port}`,
    chains,
  });
  late.harness = harness;
  const scheduler = createScheduler({ repos, harness, bus });
  const pairing = createPairing({ repos });

  let closing: Promise<void> | undefined;
  const shutdown = async (): Promise<void> => {
    notifications.stop();
    harness.shutdown();
    scheduler.stop();
    const closers: Array<Promise<void>> = [
      browser.closeAll(),
      ...engines.list().map((driver) => driver.close?.() ?? Promise.resolve()),
      ...uniqueProviders(computers).map((provider) => provider.close()),
    ];
    const results = await Promise.allSettled(closers);
    for (const result of results) {
      if (result.status === 'rejected') console.error('shutdown step failed', result.reason);
    }
    db.client.close();
  };

  return {
    config,
    db,
    repos,
    engines,
    bus,
    broker,
    harness,
    scheduler,
    vault,
    pairing,
    computers,
    mcp,
    desktop,
    browser,
    attachments,
    notifications,
    providers,
    llm,
    rooms,
    roomDecider,
    tasks,
    teamRunner,
    chains,
    close() {
      closing ??= shutdown();
      return closing;
    },
  };
}

function uniqueProviders(computers: ComputerProviders): ComputerProvider[] {
  return [...new Set(Object.values(computers).filter((provider) => provider !== undefined))];
}

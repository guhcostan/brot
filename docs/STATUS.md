# Build Status

Handoff notes for the next session. Update this file at the end of every wave.

_Last updated: 2026-10-19_

## How to resume

1. Read `AGENTS.md`. The rules are binding: the orchestrator delegates to Haiku workers, splits work by owned paths, and pushes to GitHub after each verified wave.
2. Run `pnpm install && pnpm typecheck && pnpm lint && pnpm test` to confirm a green baseline.
3. Start the next wave below.

Repo: https://github.com/guhcostan/brot (private).

## Done

| Wave | Package | State | Notes |
|---|---|---|---|
| 0 | root workspace | ✅ pushed (`62cee69`) | pnpm 10 + Turbo, `tsconfig.base.json`, oxlint, root vitest `test.projects` |
| 0 | `@brot/protocol` | ✅ pushed | zod 4. Entities, request bodies, `CanonicalEvent` union, `EngineDriver` contract, port constants |
| 0 | `@brot/db` | ✅ pushed | Drizzle 0.45 + libSQL. `createDb(url)` is **async**. `createRepos(db)` for every entity |
| 1A | `@brot/engines` | ✅ pushed | `mock`, `claude`, `codex` drivers. **Being replaced by a single `dsh` driver** (see In progress) |
| 1B | `apps/server` | ✅ pushed | Hono REST + SSE, harness, broker, scheduler, vault, device auth, pairing, webhooks |
| 2 | redesign `@brot/ui` + `apps/web` | ✅ pushed | Opus worker. Grayscale tokens, single `--attention` red, Inter + JetBrains Mono, `BotAvatar` (7 shapes, 9 colors, animated eyes per mood, blink scheduler, reduced-motion), `bot.avatar = "shape:color"` |
| 2 | web HTTP/SSE client | ✅ pushed | `createClient()` → HTTP client by default, mock with `VITE_BROT_MOCK=1`. Vite proxies `/api` to 8799 |
| 2 | `apps/cli` + `apps/relay` | ✅ pushed | `brot serve | doctor | run` with `--json`. Blind WebSocket relay (2 peers/channel, 1 MiB frames, idle timeout, no logging) |
| 2 | integration | ✅ pushed | `apps/server/src/e2e.test.ts` (approve + deny over real HTTP/SSE), `Dockerfile`, `deploy/compose.yaml`, `.github/workflows/ci.yml`. Docker build not run (daemon down) |

## Wave 3 (✅ pushed)

| Task | Owner | Notes |
|---|---|---|
| DSH engine over ACP | Haiku | `packages/engines`: `mock` + `dsh` only. Pins `@deepseek-ai/dsh@0.2.1-rc.2`, `@agentclientprotocol/sdk@1.4.0`. Launch `node <dsh>/lib/bin.js --profile acp`. One ACP process + session per thread (in memory), `session/resume` after restarts of the process. Handshake verified against real DSH with no keys |
| Electron shell | Haiku | `apps/desktop`: in-process server on an ephemeral port behind a loopback gateway on 8798 that serves `apps/web/dist` and proxies `/api`. GUI never launched |
| Expo app | Opus | `apps/mobile`: pairing (QR/paste), inbox, thread, approval sheet (Face ID before sensitive allows), settings. RN avatar reuses `packages/ui` geometry. Bundles for iOS/Android; never run on a device |
| Astro site | Opus | `apps/site`: en/pt-BR/es, living avatars as islands, static chat mock. Domain placeholder `https://brot.dev` (`SITE_URL`) |
| Locales + switcher | Haiku + Opus | pt-BR/es, sidebar language switcher without reload |
| Desktop title bar, avatar hydration | Opus | macOS drag strip via Electron UA detection; `BotAvatar` SSR-safe motion/phase |
| `LICENSE` | orchestrator | AGPL-3.0 |

## Wave 4 (✅ pushed: `7118f3c` contracts, `f549664` implementation)

Containment model in docs/ARCHITECTURE.md. Docker provider (internal network + per-bot egress sidecar proxy, hardened container, `images/computer`), host provider (desktop only), Brot MCP server at `/mcp/runs/:runId` (per-run 256-bit token, every call through the broker, secrets after allow; tools `http_request`, `notify_user`, `remember`), harness placement without fallback, persisted DSH sessions, `computer: none` runs DSH with a no-tools overlay. Seeded Capy is `computer: none`.

**Never exercised against a real Docker daemon** (it was down): build `images/computer` and `images/computer/egress.Dockerfile`, then run the 3 skipped real-daemon tests and a real egress check. Unverified: that DSH honours `HTTPS_PROXY` inside the container.

Known gaps: no `ComputerProvider.remove(botId)` (deleting a bot leaves its container/network/volume); no idle-stop `computer.status`; `network.blocked` can be attributed to the wrong thread when runs overlap; providers get `config.port` before listen (port 0 breaks the docker relay, tests inject providers); provider keys inside the computer (`computerEnv`) are readable by the agent: decide how DSH gets model keys; secret redaction is literal-only; run tokens of runs that never settle stay in memory.

## Wave 5: teams (✅ pushed)

Spec: docs/TEAM-API.md. Contracts `ac08dd8` (rooms, members, responder mode, `Message.authorBotId/mentions/viaBotId`, `thread_sessions`, `Task` with chains, events `task.*`/`handoff`/`bot.asked`/`bot.answered`/`room.members`), then:
- Server: rooms API, `@mention`/lead routing (sequential responders), per-bot DSH sessions, labeled history, tasks API (user task starts the assignee in its DM, `workRunId`, cancel stops the run), chain tracking and per-chain cost, `GET /api/threads/:id/events?after=`.
- Team MCP tools (`apps/server/src/team`): `list_team`, `ask_bot`, `delegate_task`, `update_my_task`, `handoff`. Guards: no self-target, ask cycles, hop/depth/chain-size limits, smallest `teamBudgetUsd` in the chain; result posted back and the delegator notified once.
- DSH driver keyed by (thread, bot); fixed a kill path that returned while the child was still a zombie.
- DB: WAL + busy timeout + an in-process write gate (libSQL is synchronous, so a pooled connection blocked the transaction holding the lock). Rule: inside `db.transaction` use only `tx`.
- Web (Opus): rooms in the sidebar, new-room dialog, `@mention` combobox, author per message, collapsible bot-to-bot rows with gaze, handoff baton, task board + context tab. Smoke-tested against the real server with the mock engine (mention routing, task to done).

Open: no UI to add/remove room members; baton is in memory (lost on restart); global SSE replay pages by timestamp and can skip same-millisecond events (needs an id cursor); `workRunId` set without `task.updated`; DSH processes share `DSH_HOME` (concurrent session store unverified); mobile has no team UI yet.

## Next (wave 6 candidates)

1. Run the real stack: start Docker, build the images, run the skipped tests, then a real DSH run with a provider key end to end (approval → send).
2. Mobile team UI (Opus): rooms, task board, bot-to-bot rows.
3. SSE id cursor for replay; room member management UI; persist the baton.
4. Model keys for DSH inside computers via the vault (`secret://`), never plain env.

## Decision: DeepSeek Harness is the only runtime (2026-10-19)

The user chose DSH (`@deepseek-ai/dsh`, MIT) as the single agent runtime, driven over ACP. Providers are configured inside DSH (DeepSeek, Anthropic API, OpenAI, OpenRouter, local, and DSH's native sign-ins such as ChatGPT/Codex OAuth). Brot must not route Claude Free/Pro/Max OAuth outside Claude Code: Anthropic's terms forbid it. DSH is a developer preview, so pin its version and keep it behind `EngineDriver`.

## Backlog

- Server gaps: `GET /api/threads/:id/events` for exact history; SSE `Last-Event-ID` replay; make `trustLoopback` configurable (a same-host reverse proxy currently skips auth); first-device pairing through Docker's published port; `run.cancelled` event; webhook HMAC; `runs.listByStatus`.
- Relay: the server must mint channel ids with ≥128 bits of randomness; server-side relay client not built. CLI needs a `--token` flag for remote servers.
- Docker: digest-pin `node:24-slim`, drop devDependencies from the runtime image, run `docker build` once the daemon is up.
- `useChat`: buffer live events until `history-loaded` so early deltas aren't lost.
- Mobile: real push notifications, live computer view, typed routes; pairing by 6-digit code needs server support. Stop/Unpair use neutral styling (DESIGN.md says danger for Stop): revisit.
- Site: waitlist has no backend; Download points to GitHub Releases (empty until the first desktop release).

## Known decisions and gaps

- **Protocol vs. ARCHITECTURE.md**: the event union has no `computer.frame` or `handoff` yet. `EngineDriver` uses a single `run(ctx)` with `ctx.requestTool()` instead of `start/respond/cancel`. Add those events when computers and rooms are built.
- **Engines**: `run()` throws on failure, and the harness turns that into `run.failed`. `registry.register()` throws on a duplicate id.
- **Server decisions**: no `run.cancelled` event yet (cancel publishes `run.failed`). The JSON content-type and loopback `Host` guards block CSRF and DNS rebinding. Pairing `host` defaults to 127.0.0.1 (set `BROT_HOST` to the LAN IP for phones), and the 6-digit code isn't checked. No webhook HMAC yet. `packages/db` needs `runs.listByStatus`.
- **Design**: light `--ink-3` is `#6F6F6F` (not `#737373`) so placeholders on `--surface-2` pass AA. Safari animates the eye-path morph instantly instead of tweening.
- **Environment**: Docker is installed but the daemon wasn't running, so the sandbox image (`images/computer`) hasn't been built or tested.
- **Out of scope for v1**: Brot Cloud (Firecracker, Stripe), computers/sandboxes, Composio, REA, social publishing. See `docs/ROADMAP.md`.

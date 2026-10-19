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

## In progress (wave 3, uncommitted in the working tree)

Paused when the usage limit hit. Nothing below is committed; run the checks before committing.

| Task | State | Paths |
|---|---|---|
| pt-BR + es locales | ✅ done, verified by worker (55 web tests) | `apps/web/locales`, `apps/web/src/i18n.ts` |
| Electron shell | ✅ done, 38 tests, build OK; GUI never launched | `apps/desktop` (root: `electron` added to `onlyBuiltDependencies`, `apps/desktop/release/` ignored) |
| Astro site (Opus) | ✅ done, build + astro check OK, screenshots in scratchpad | `apps/site` |
| DSH engine over ACP (Haiku) | ⏸ stopped mid-way: `dsh.ts` started, fake ACP agent not finished, lint error (unused import) | `packages/engines` |
| Expo mobile app (Opus) | ⏸ stopped mid-way: pure logic passing, theme/UI layer not done, lint errors in `src/api/client.test.ts` | `apps/mobile` |

To resume: re-spawn the DSH worker (Haiku) and the mobile worker (Opus) with their original specs plus "continue from the existing files". Then one Opus UI follow-up: language switcher in `Sidebar.tsx` (spec in the locales worker's report: select calling `setLocale` + reload), macOS `-webkit-app-region: drag` title strip for desktop, and the stale `data-animated` attribute after SSR hydration under reduced motion in `BotAvatar`.
Root to-dos: add an AGPL-3.0 `LICENSE` file (site links to gnu.org meanwhile), confirm the site domain (placeholder `https://brot.dev`), add a per-launch server token for desktop (any local process can reach the embedded server through `trustLoopback`), `migrate()` `migrationsFolder` option for the esbuild CJS bundle.

## Decision: DeepSeek Harness is the only runtime (2026-10-19)

The user chose DSH (`@deepseek-ai/dsh`, MIT) as the single agent runtime, driven over ACP. Providers are configured inside DSH (DeepSeek, Anthropic API, OpenAI, OpenRouter, local, and DSH's native sign-ins such as ChatGPT/Codex OAuth). Brot must not route Claude Free/Pro/Max OAuth outside Claude Code: Anthropic's terms forbid it. DSH is a developer preview, so pin its version and keep it behind `EngineDriver`.

## Next

- Wire contract changes the DSH worker reports (likely a persisted engine session id per thread, plan/usage events).
- Server gaps: `GET /api/threads/:id/events` for exact history; SSE `Last-Event-ID` replay; make `trustLoopback` configurable (a same-host reverse proxy currently skips auth); first-device pairing through Docker's published port; `run.cancelled` event; webhook HMAC; `runs.listByStatus`.
- Relay: the server must mint channel ids with ≥128 bits of randomness; server-side relay client not built. CLI needs a `--token` flag for remote servers.
- Docker: digest-pin `node:24-slim`, drop devDependencies from the runtime image, run `docker build` once the daemon is up.
- `useChat`: buffer live events until `history-loaded` so early deltas aren't lost.
- Web language switcher once locales land.

## Known decisions and gaps

- **Protocol vs. ARCHITECTURE.md**: the event union has no `computer.frame` or `handoff` yet. `EngineDriver` uses a single `run(ctx)` with `ctx.requestTool()` instead of `start/respond/cancel`. Add those events when computers and rooms are built.
- **Engines**: `run()` throws on failure, and the harness turns that into `run.failed`. `registry.register()` throws on a duplicate id.
- **Server decisions**: no `run.cancelled` event yet (cancel publishes `run.failed`). The JSON content-type and loopback `Host` guards block CSRF and DNS rebinding. Pairing `host` defaults to 127.0.0.1 (set `BROT_HOST` to the LAN IP for phones), and the 6-digit code isn't checked. No webhook HMAC yet. `packages/db` needs `runs.listByStatus`.
- **Design**: light `--ink-3` is `#6F6F6F` (not `#737373`) so placeholders on `--surface-2` pass AA. Safari animates the eye-path morph instantly instead of tweening.
- **Environment**: Docker is installed but the daemon wasn't running, so the sandbox image (`images/computer`) hasn't been built or tested.
- **Out of scope for v1**: Brot Cloud (Firecracker, Stripe), computers/sandboxes, Composio, REA, social publishing. See `docs/ROADMAP.md`.

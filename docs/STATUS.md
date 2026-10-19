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
| 0 | `@brot/protocol` | ✅ pushed | zod 4. Entities, request bodies, `CanonicalEvent` union, `EngineDriver` contract, port constants. 27 tests |
| 0 | `@brot/db` | ✅ pushed | Drizzle 0.45 + libSQL. `createDb(url)` is **async**. drizzle-kit migrations in `packages/db/drizzle/`. `createRepos(db)` for every entity. 27 tests |
| 1A | `@brot/engines` | ✅ pushed | `mock`, `claude`, `codex` drivers + registry. 45 tests. Detects claude 2.1.303 and codex 0.160.1 locally |
| 1C | `@brot/ui` + `@brot/web` | ✅ pushed | Tokens (CSS + TS, contrast tested), components, fauna avatars, three-pane chat with phone layout, approval cards, event fold. 15 tests, build OK. **Runs against an in-process mock client.** It still needs an HTTP/SSE `BrotClient` wired to the server |
| 1B | `apps/server` | ✅ pushed | Hono REST + SSE, harness, broker, scheduler, vault, device auth, pairing, webhooks. 50 tests. Boots and answers `/api/health` |
| — | docs | ✅ pushed | README, AGENTS, DESIGN (BR + bot, Brazilian fauna), SECURITY, CONTRIBUTING, `docs/*` |

## In progress

| Wave | Package | Owner | Notes |
|---|---|---|---|
_Nothing running._

## Next: redesign (user request, top priority)

The user finds the current UI too childish and too colorful. They want it **minimal and neutral like Grok Bot and MausBot**:
- Grayscale chrome (white/near-black, grays), black primary buttons, one attention color (red) for approvals and errors only. Inter + JetBrains Mono, no serif.
- **Bot avatars as solid flat geometric shapes with two simple white eye strokes**: circle, squircle, tilted rounded square, cloud, rounded triangle, blob, small drop. Flat saturated colors (black, teal, violet, blue, orange, amber, pink, brown, gray) used only on avatars. Expressions come from the eyes only.
- No animal illustrations. The Brazilian identity stays in the bot names and personalities.

Steps: rewrite `DESIGN.md` §2–§7 accordingly (the current file still describes the old warm palette and fauna), then have a worker restyle `packages/ui` and `apps/web`.

## Next waves (not started)

These can run in parallel, one worker each, with owned paths in brackets:

- **1C follow-up** [`apps/web`]: implement an HTTP + SSE `BrotClient` against the server (same interface as `apps/web/src/data/client.ts`), keep the mock for tests, and add the pt-BR and es locales.
- **1D CLI + relay** [`apps/cli`, `apps/relay`]: `brot serve | doctor | run <botId> <message>`, with a `--json` flag. A relay that blindly forwards WebSocket frames between a paired phone and a server, with no plaintext access.
- **1E desktop + mobile** [`apps/desktop`, `apps/mobile`]: an Electron shell that embeds `startServer()` and loads the web build. An Expo app with QR pairing (`/api/pairing/*`), an inbox, chat, approvals, and push placeholders. Verify by typecheck and build only.
- **1F landing site** [`apps/site`]: an Astro marketing page following DESIGN.md §10. Hero with Capy, the fauna team, how it works, self-host vs. Brot Cloud, and Download / Start on Cloud CTAs. English with a language switcher.
- **2 integration**: an end-to-end test that boots the server with the mock engine, creates a bot, posts a message, approves a tool call, and checks the events. `deploy/compose.yaml` + `Dockerfile`. CI workflow in `.github/workflows/ci.yml`.

## Known decisions and gaps

- **Protocol vs. ARCHITECTURE.md**: the event union has no `computer.frame` or `handoff` yet. `EngineDriver` uses a single `run(ctx)` with `ctx.requestTool()` instead of `start/respond/cancel`. Add those events when computers and rooms are built.
- **Engines**:
  - `bot.model` is passed as `--model` (claude) or `-m` (codex).
  - Claude's internal tool use isn't surfaced as Brot tool calls yet. Only text and usage are mapped.
  - `run()` throws on failure, and the harness must turn that into `run.failed`.
  - `registry.register()` throws on a duplicate id.
- **Risks to fix**:
  - `codex exec` fails outside a git repo. Run it in a git working dir, or add `--skip-git-repo-check` deliberately.
  - The prompt is passed as a single argv entry, and Linux caps that at about 128 KiB. Move it to stdin for long histories.
- **Server decisions**: no `run.cancelled` event yet (cancel publishes `run.failed`). The JSON content-type and loopback `Host` guards block CSRF and DNS rebinding. Pairing `host` defaults to 127.0.0.1 (set `BROT_HOST` to the LAN IP for phones), and the 6-digit code isn't checked. No webhook HMAC yet. `packages/db` needs `runs.listByStatus`.
- **Design contrast** (old palette): `--live`/`--danger` on white (about 4.4:1) and `--sun`/`--warn` on paper (about 3.2:1) fail AA as text. The UI uses them only for borders, dots, and icons. DESIGN.md needs text-safe variants.
- **Environment**: Docker is installed but the daemon wasn't running, so the sandbox image (`images/computer`) hasn't been built or tested.
- **Out of scope for v1**: Brot Cloud (Firecracker, Stripe), computers/sandboxes, Composio, REA, social publishing. See `docs/ROADMAP.md`.

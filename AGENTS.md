# AGENTS.md

Instructions for any coding agent (Claude Code, Codex, Cursor, Gemini CLI…) working in this repo. More specific `AGENTS.md` files in subdirectories override this one within their directory. `CLAUDE.md` points here.

## What Brot is

An open-source (AGPL-3.0) team of AI bots in a chat app. Each bot has a job, an engine/model, its own sandboxed computer, connected apps, skills, and inspectable memory. It runs as a desktop app, a self-hosted server, or on Brot Cloud, and can be controlled from a paired phone. Read before changing anything substantial:

- [`docs/PRODUCT.md`](docs/PRODUCT.md): features and priorities (P0/P1/P2)
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): processes, event protocol, repo layout
- [`docs/TECH-STACK.md`](docs/TECH-STACK.md): chosen libraries and why
- [`DESIGN.md`](DESIGN.md): tokens, typography, components, voice
- [`docs/BROWSER-AGENT.md`](docs/BROWSER-AGENT.md), [`docs/REMOTE-CONTROL.md`](docs/REMOTE-CONTROL.md), [`docs/REA-INTEGRATION.md`](docs/REA-INTEGRATION.md)

**Current build state and next steps: [`docs/STATUS.md`](docs/STATUS.md).** Read it first when resuming work, and update it at the end of every wave.

## Commands

```bash
pnpm install          # Node 24+, pnpm 10+
pnpm dev              # server (127.0.0.1:8799) + web (5199)
pnpm build            # turbo build of every package
pnpm typecheck
pnpm lint             # oxlint
pnpm test             # vitest across the workspace
pnpm --filter @brot/server test   # one package
```

A change is done only when `pnpm typecheck && pnpm lint && pnpm test` pass for the packages you touched.

## Repo map

| Path | Owns |
|---|---|
| `packages/protocol` | Canonical events, API contracts, `EngineDriver` interface (zod). **The contract every other package depends on** |
| `packages/db` | Drizzle schema + migrations (SQLite/libSQL; Postgres later) |
| `packages/engines` | Engine drivers: `mock`, `claude`, `codex` |
| `packages/ui` | Design tokens + React components (follows DESIGN.md) |
| `apps/server` | Hono API, SSE, harness, permission broker, scheduler, vault, pairing |
| `apps/web` | React 19 + Vite chat UI |
| `apps/cli` | `brot` CLI |
| `apps/desktop` | Electron shell embedding the server |
| `apps/mobile` | Expo remote-control app |
| `apps/relay` | E2E blind relay for phone pairing |
| `images/computer`, `deploy/` | Sandbox image, docker compose |

## Multi-agent workflow (rule)

Implementation work in this repo is **orchestrated, not done by one agent**:

1. **The orchestrator delegates and integrates.** The main agent plans, splits the work, writes the specs, reviews results, and runs the final verification. It does not write the feature code itself.
2. **Workers are Claude Haiku 5.5 subagents** (`model: "haiku"`). They're cheap and fast, so independent tasks run in parallel. Escalate to a larger model only for a task Haiku failed twice.
3. **Split by owned paths.** Every worker gets an explicit list of directories it owns and may edit. It never edits outside them. Root files (`package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `AGENTS.md`, `docs/`) belong to the orchestrator unless a task assigns them.
4. **Contracts first.** Shared contracts (`packages/protocol`, `packages/db`) land in their own wave before dependents fan out. A worker that needs a contract change reports it rather than editing another package.
5. **Workers verify their own slice** (typecheck, lint, tests in their package) and report: files changed, commands run with results, and anything unfinished. They never claim something works without running it.
6. **Concurrent installs**: if `pnpm install` fails because another worker changed the lockfile at the same moment, wait a few seconds and retry.
7. **Always push to GitHub.** After each verified unit of work (a wave, a feature, a fix), the orchestrator commits and pushes to `origin` (github.com/guhcostan/brot). Use Conventional Commits (`feat(server): …`, `docs: …`). Commit only after `typecheck`, `lint`, and `test` pass. Workers don't commit or push themselves. That avoids racing commits. Never force-push `main`, never commit secrets or `.env` files.

## Conventions

- TypeScript strict, ESM, Node 24. No `any` in exported types. Validate every external input with zod from `@brot/protocol`.
- Tests with Vitest beside the code (`*.test.ts`). Engines and the harness are tested against the `mock` engine, never a live model.
- Never verify mutations against the user's real data dir. Tests use a temp `BROT_HOME`.
- Comments only for what code can't say: a license notice, an external fact (vendor, CLI, OS behavior, with version), a public contract's doc comment, a security invariant. No narration, no history, no commented-out code.
- UI uses only tokens from `packages/ui`. No ad-hoc colors or fonts.

## Guardrails (non-negotiable)

- **No circumvention of site protections.** No code that bypasses, spoofs, or defeats CAPTCHAs, bot detection, fingerprinting, or access controls. When a site challenges, the bot hands the step to the human.
- **Irreversible actions require approval**: payments, purchases, posts, sends, deletions, permission changes. Route them through the permission broker.
- **Secrets never enter model context.** Bots receive `secret://` references. The broker injects values into the computer only.
- Only the user's own accounts. No multi-account or fake-identity features.
- REA teardowns require the user's authorization acknowledgement.

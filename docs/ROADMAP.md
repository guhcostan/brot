# Roadmap

Phases, not dates. A phase ships when its exit criteria pass.

## Phase 0: Foundations
Monorepo (pnpm + Turbo), `@brot/protocol` events and contracts, `@brot/db` schema, CI (typecheck, lint, test).
**Exit:** `pnpm install && pnpm typecheck && pnpm test` is green on a clean clone.

## Phase 1: MVP core (P0)
Server: harness, mock/claude/codex engines, permission broker with approval cards, policies, scheduler (cron + webhook), vault, SSE.
Web: sidebar → thread → context panel, streaming, tool cards, approvals, memory and skills tabs.
CLI: `brot serve | run | doctor`.
**Exit:** create a bot, chat with it on Claude, approve a tool call, schedule a routine, all covered by e2e tests on the mock engine.

## Phase 2: Computers, apps & phone (P0)
`brot-computer` Docker image with live screen and takeover. Composio and user MCP servers. Relay + Expo app with QR pairing, approvals, and push. Electron desktop packaging.
**Exit:** approve a bot's action from a paired phone while the bot runs on the laptop.

## Phase 3: Web actions & teardowns (P1)
Official-API publishing (X, Instagram, TikTok, LinkedIn, YouTube), browser actions on the user's session with human takeover, REA teardowns, Product Detective, Competitor Watch.
**Exit:** the publish flow and a teardown pass the eval suite.

## Phase 4: Brot Cloud alpha (P1)
Control plane, Stripe, Firecracker microVMs (Fly first), Postgres, backups, rooms and handoffs, the "Move to Cloud" migration.
**Exit:** sign up to a working bot in under 60s, and a bot keeps running while the laptop is closed.

## Phase 5: GA & ecosystem (P1/P2)
Teach-by-demonstration, Team Gallery, published evals, i18n, SSO, audit export, Enterprise.

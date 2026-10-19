# Roadmap

Phases, not dates. A phase ships when its exit criteria pass. Day-to-day build state lives in [`STATUS.md`](./STATUS.md).

Legend: ✅ done · 🔨 in progress · ⏳ next · 💤 later

## v1: the self-hosted core

The first release. Everything runs on the user's own machine, with no cloud dependency.

### Phase 0: Foundations ✅
- ✅ Monorepo (pnpm + Turbo), oxlint, Vitest
- ✅ `@brot/protocol`: entities, events, engine contract
- ✅ `@brot/db`: Drizzle + libSQL schema and repositories
- ⏳ CI workflow (typecheck, lint, test on every push)

**Exit:** `pnpm install && pnpm typecheck && pnpm test` is green on a clean clone.

### Phase 1: Server & engines ✅
- ✅ `@brot/engines`: `mock`, `claude`, `codex` drivers + registry
- ✅ `apps/server`: REST + SSE, harness, permission broker with approvals and policies, scheduler (cron + webhook), vault, device auth, pairing
- ⏳ Harness fixes: run `codex` inside a git working dir, pass long prompts via stdin

**Exit:** with the mock engine, create a bot, chat, approve a tool call, and fire a routine, all covered by tests.

### Phase 2: Apps ⏳
- 🔨 `packages/ui` + `apps/web`: chat UI on the DESIGN.md tokens, light and dark (built on a mock client; needs the server client and the pt-BR / es locales)
- ⏳ `apps/cli`: `brot serve | doctor | run`
- ⏳ `apps/desktop`: Electron shell embedding the server
- ⏳ `apps/mobile` + `apps/relay`: Expo app, QR pairing, approvals from the phone
- ⏳ `apps/site`: landing page with Download and Brot Cloud CTAs

**Exit:** from a paired phone, approve an action from a bot running on the laptop.

### Phase 3: Ship v1 ⏳
- ⏳ End-to-end test suite on the mock engine
- ⏳ `deploy/compose.yaml` + `Dockerfile` for self-hosting
- ⏳ Signed desktop builds (macOS, Windows, Linux), first GitHub release
- ⏳ Docs site, public repo, license files (AGPL-3.0 core)

**Exit:** a stranger installs Brot from the README and has a bot doing real work on Claude in under 3 minutes.

## After v1

### Phase 4: Computers & apps 💤
- `brot-computer` Docker sandbox per bot, live screen, human takeover
- Composio connectors and user MCP servers
- Rooms: several bots in one chat, handoffs between bots
- Editable workspace memory, knowledge sources

### Phase 5: Brot Cloud 💤
- Control plane, Stripe billing, usage metering
- Firecracker microVMs (Fly Machines first), Postgres, backups
- "Move this bot to Cloud" from the desktop app
- Hosted relay for self-hosters

**Exit:** sign up to a working bot in under 60s, and the bot keeps running with the laptop closed.

### Phase 6: Differentiators 💤
- Official-API social publishing (X, Instagram, TikTok, LinkedIn, YouTube)
- REA teardowns, Product Detective, Competitor Watch
- Teach by demonstration (record a workflow, get a skill)

### Phase 7: Ecosystem 💤
- Team Gallery, shareable teams and skills
- Published eval suite with success rates per engine
- SSO, audit export, Enterprise tier

# Architecture

> **As built today (2026-10-22):** a single Node server (`apps/server`, Hono) on 127.0.0.1 with
> SQLite/libSQL, one runtime (DSH over ACP), Docker sandbox computers with per-bot egress sidecars, a
> host computer on macOS, a permission broker, an AES-256-GCM vault, routines on croner, and a React web
> app plus Electron shell, Expo app and CLI. **Not built yet:** Postgres, multi-tenant Cloud, Better Auth,
> Firecracker, the MCP client hub (Composio/user MCP/REA), embeddings, pg-boss, `computerd`, noVNC/KasmVNC,
> and the cloud control plane. The diagrams and tables below describe the target shape; see
> `docs/STATUS.md` for current state and `docs/MAUSBOT-PARITY.md` for the plan.


## One codebase, three deployment shapes

```
            ┌──────────────── same Brot server ("oven") ────────────────┐
 Desktop    │ Electron shell → embedded server → SQLite  → sandbox: Docker│
 Self-host  │ docker compose  → server (+ workers)       → Postgres → Docker/VM │
 Brot Cloud │ k8s/Nomad → server pods + control plane    → Postgres → Firecracker microVMs │
            └──────────────────────────────────────────────────────────┘
```

The **server is the product**. Desktop and Cloud are packaging. A self-hoster runs exactly the code that Brot Cloud runs, with `BROT_MODE=selfhost|desktop|cloud` toggling only infra adapters (computers, storage, billing).

## Process model

```
 ┌───────────── clients ─────────────┐
 │ Web/PWA · Desktop · Mobile · CLI  │
 └──────┬──────────────▲─────────────┘
        │ typed HTTP   │ SSE (canonical events)
 ┌──────▼──────────────┴──────────────────────────────────────────┐
 │ apps/server  (Hono, Node 24)                                   │
 │  ├─ api/          REST + SSE, loopback trust + device tokens       │
 │  ├─ harness/      run loop, event bus, thread log, cost meter   │
 │  ├─ engines/      drivers: dsh (ACP) · mock (tests)          │
 │  ├─ broker/       permission broker → approvals, policies       │
 │  ├─ computers/    host(Cua) · docker · firecracker · remote     │
 │  ├─ tools/        MCP server for bots (no client hub yet)       │
 │  ├─ memory/       facts, summaries, embeddings (sqlite-vec/pgvector) │
 │  ├─ scheduler/    routines, triggers (croner local / pg-boss)   │
 │  ├─ hooks/        webhook receiver (separate port, secret URLs) │
 │  └─ vault/        secrets (keychain / sealed box), short-lived refs │
 └───────┬───────────────────────────┬────────────────────────────┘
         │ Drizzle                    │ gRPC/WebSocket control
   SQLite | Postgres           brot-computer (per bot)
                               ├─ computerd (agent-side daemon)
                               ├─ Xvfb + XFCE + Chromium + Playwright
                               ├─ KasmVNC/noVNC (→ WebRTC later)
                               └─ toolchain: node, python, git, REA, Ghidra*
```

### Canonical event protocol (`packages/protocol`)
The DSH runtime's ACP notifications is normalized into **one versioned event union**, validated with zod:

`run.started · message.delta · message.completed · tool.call · tool.result · approval.requested · approval.resolved · computer.status · computer.frame · network.blocked · memory.written · task.created · task.updated · handoff · bot.asked · bot.answered · room.members · cost.updated · run.completed · run.failed`

- The log is append-only per thread (an `events` table, also exportable as NDJSON).
- The UI state is a pure fold over events, so you can replay, time-travel debug, and share runs.
- DSH is the single runtime; providers are configured inside it. `EngineDriver` keeps the runtime replaceable.

### Engine driver interface (sketch)
```ts
interface EngineDriver {
  id: string;                         // "dsh", "mock"
  detect(): Promise<EngineAvailability>; // installed? logged in? why not?
  models(): Promise<ModelInfo[]>;
  start(run: RunContext): AsyncIterable<CanonicalEvent>;
  respond(runId: string, input: ApprovalAnswer | UserMessage): Promise<void>;
  cancel(runId: string): Promise<void>;
}
```

### Vision (image attachments in prompts)
Providers opt models into images per model entry in `$BROT_HOME/providers.json`:
`{"id": "…", "vision": true}`. Every model without it is text-only; the seeded providers are text-only until a
proxy that forwards image blocks is configured. `ResolvedRoute.vision` carries the flag for the run's attempt.

- The server attaches images from **the current trigger message only**: `image/png`, `image/jpeg`, `image/webp`
  or `image/gif`, at most **4 images** and at most **5 MiB per image**. Larger, unsupported, unreadable or extra
  images are skipped and logged by attachment name and reason — never by content.
- A text-only route gets no image bytes. Its prompt still lists each attachment's name, type and size, so the model
  knows an image exists without seeing it.
- Capability is recomputed per attempt: a fallback from a vision model to a text-only model drops the images.
- The bytes travel in memory as base64 in `RunContext.images`; they are never persisted, never logged and never
  part of an event. DSH sends them as ACP content blocks (`{type:"image", data, mimeType}` after the text block)
  only on the first turn of a fresh session. A primed session stays text-only because its earlier turns already
  hold the images. The mock engine ignores `ctx.images`.

### Voice notes and opt-in transcription
Audio attachments (`audio/webm`, `audio/ogg`, `audio/mpeg`, `audio/wav`, `audio/x-wav`, `audio/mp4`,
`audio/aac`, `audio/flac`) are stored like any other attachment and get `kind: "audio"`. They share the 20 MiB
upload cap and are never sent to a text model.

Speech-to-text is opt-in and configured separately from a bot's chat model:

- A provider model in `$BROT_HOME/providers.json` opts in with `{"id": "whisper-1", "transcription": true}`. The
  provider must use the `openai-completions` API; Brot posts multipart `model` + `file` to
  `<baseUrl>/audio/transcriptions`, with the provider key read from the vault at call time (60 s timeout).
- The saved settings (`GET/PUT /api/transcription`) hold only `<provider>/<model>` under the `transcription`
  settings key. `GET` also reports whether the model resolves and its vault secret exists, without a network call.
- A run transcribes at most **2** audio attachments of the current trigger message, each up to the upload cap,
  only when a transcription model is configured. A failed transcription skips that attachment (logs name and
  reason only, never audio bytes or keys) and the run continues with the message text.
- Transcribed text reaches the engine as `RunContext.audioTranscripts` and is rendered inside the prompt's
  `Attachments:` list as `- <name> (transcript): <text>`, each transcript capped at 4,000 characters. Without a
  transcription model the list shows only the attachment's name, media type and size.
- Nothing is transcribed from history or tool results, and transcripts are not persisted as events. No STT
  provider is configured by default; the behaviour is exercised with an injected fetch in tests.

### Permission broker
- Every tool call passes through `broker.decide(call, botPolicy)`, which returns `allow | deny | ask`.
- `ask` emits `approval.requested` and **suspends** the run (state persisted, so it survives restarts).
- "Allow always" writes a policy row (`bot, tool, argPattern, scope, expiresAt`).
- Secrets: the bot asks for `secret://gmail-app-password`. The broker injects it into the computer's environment or keystroke stream and never into model context.

### Computers
| Provider | Mode | Isolation | Notes |
|---|---|---|---|
| `host` | desktop | none (opt-in) | Cua driver. macOS + X11 Linux |
| `docker` | desktop, self-host | container (gVisor optional) | default; image `ghcr.io/brot/computer` |
| `firecracker` | cloud, self-host advanced | microVM | per-bot persistent volume, suspend on idle |
| `remote` | any | provider's | adapter for E2B/Boat/Daytona if a user prefers |

**Default is one computer per bot.** Rooms can mount a shared folder explicitly.

### Containment model (why approvals hold with DSH)
DSH asks permission only when a call escalates out of its own sandbox, so Brot does not rely on the runtime to ask. The guarantee comes from three layers:
1. **Containment**: DSH runs inside the bot's computer. Shell and file actions are free there because the computer is disposable.
2. **Egress denied by default**: the computer reaches only the model provider's hosts plus the bot's `egress` allowlist. Blocked attempts emit `network.blocked`.
3. **Brot MCP tools are the only way out**: sending, posting, paying, deleting and permission changes exist only as Brot MCP tools (`BrotToolSpec` with a `risk`). They call the broker before acting and receive `secret://` values only at execution time.

DSH's own `session/request_permission` still routes to the broker as an extra layer. `computer: none` runs DSH with no shell or file tools (Brot MCP tools only). `computer: host` is desktop-only and needs explicit acknowledgement, because layers 1 and 2 don't apply there.

### Scheduling
- Desktop: `croner` in-process with persisted next-run times. Missed runs resume on wake (with policy: run-once or skip).
- Server/Cloud: **pg-boss** (Postgres-native jobs), with no Redis required.
- Triggers: cron, webhook (`/h/<secret>`), app events (Composio long-poll or GitHub/Stripe webhooks), file watch.

### Data
- **Drizzle ORM** with two dialects: SQLite (libSQL) for desktop and small self-host, Postgres 16+ for team self-host and Cloud.
- Vectors: `sqlite-vec` and `pgvector`.
- Blobs (attachments, screenshots, recordings): local FS or S3-compatible (MinIO / R2).
- Tenancy: every row carries `workspace_id`. Postgres RLS is enabled in Cloud.

## Repository layout (pnpm + Turborepo)

```
brot/
├─ apps/
│  ├─ server/        # the oven: API, harness, broker, scheduler
│  ├─ web/           # React 19 + Vite + TanStack Router/Query (PWA)
│  ├─ desktop/       # Electron shell, embeds server, auto-update
│  ├─ mobile/        # Expo app, paired remote control (see REMOTE-CONTROL.md)
│  ├─ relay/         # E2E blind relay for phone ↔ desktop/self-host
│  ├─ cli/           # `brot` CLI (serve, run, team, doctor)
│  ├─ site/          # Astro marketing site + Team Gallery
│  └─ docs/          # Astro Starlight docs (docs.brot.dev)
├─ packages/
│  ├─ protocol/      # canonical events + API contracts (zod)
│  ├─ engines/       # engine drivers
│  ├─ computers/     # computer providers + computerd client
│  ├─ tools/         # MCP hub, Composio, REA adapter
│  ├─ db/            # Drizzle schema, migrations (sqlite + pg)
│  ├─ ui/            # design system (tokens, components) — see DESIGN.md
│  ├─ mascot/        # "Brötchen" SVG/Rive states
│  ├─ skills/        # SKILL.md parser, validator, built-in skills
│  └─ config/        # tsconfig, oxlint, vitest presets
├─ images/
│  └─ computer/      # Dockerfile for brot-computer (+ computerd in Go)
├─ cloud/            # control plane: provisioning, billing, metering (BROT_MODE=cloud)
├─ deploy/           # docker-compose, helm chart, one-click templates
├─ teams/            # built-in role templates (Markdown)
├─ evals/            # task suites + harness for published success rates
└─ docs/             # product/eng docs (this folder)
```

## Brot Cloud specifics

- **Control plane** (`cloud/`): signup, workspace provisioning, Stripe, usage metering (compute-minutes, credits), region routing.
- **Data plane**: server pods per region on shared Postgres with RLS. Larger tenants get dedicated pods.
- **Computers**: Firecracker microVMs on bare metal (Hetzner/OVH/Latitude) with a Nomad or custom scheduler. They **suspend after N minutes idle** and resume in under a second from a snapshot. This is the main lever on margins.
- Stage-0 shortcut: start on **Fly Machines** (Firecracker under the hood) before owning metal.
- **Relay** for self-hosters (P2): an outbound tunnel so self-hosted servers get webhooks and mobile push without exposing ports. It's a paid add-on.

## Security baseline
- Server binds to `127.0.0.1` by default in desktop mode. Remote access requires auth plus pairing.
- Webhooks run on a separate listener with unguessable secret paths and HMAC verification.
- Computers have no access to the server's database or vault. They talk to the server only via `computerd` with a per-computer token.
- Egress policy per bot (allowlist mode for regulated users).
- Supply chain: pinned images by digest, SBOM, signed releases (Sigstore), and Renovate.
- Threat model and disclosure live in `SECURITY.md`.

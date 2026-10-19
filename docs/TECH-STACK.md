# Tech Stack

Each choice records **why**, so we can revisit it deliberately.

## Language & tooling
| Choice | Why |
|---|---|
| **TypeScript (strict)** everywhere except `computerd` | One language for server, web, desktop, CLI, and mobile. Matches REA and MausBot ecosystems |
| **Go** for `computerd` (in-VM daemon) | Static binary, tiny footprint inside every sandbox |
| **Node 24 LTS** | Satisfies REA (24.11+). Native `fetch`, test runner, and permission model |
| **pnpm workspaces + Turborepo** | Fast monorepo, remote cache. Same pattern as REA |
| **oxlint + oxfmt** | Fast. Same as REA |
| **Vitest** (+ Playwright for e2e) | Unit/integration plus real browser tests |
| **Changesets** or release-please | Versioned packages, generated changelogs |

## Backend (`apps/server`)
| Choice | Why |
|---|---|
| **Hono** | Small, fast, typed. Runs on Node, Bun, and edge. Built-in SSE helpers |
| **zod** + `@hono/zod-openapi` | Contracts become validation and generated OpenAPI plus a TS SDK |
| **Drizzle ORM** (libSQL/SQLite + Postgres) | One schema, two dialects. SQL-first, easy migrations |
| **pg-boss** | Jobs and cron on Postgres, so no Redis to operate |
| **croner** | In-process cron for desktop mode |
| **Better Auth** | Self-hostable auth (email, OAuth, passkeys, orgs). No vendor lock-in |
| **@anthropic-ai/claude-agent-sdk** | First-class Claude engine |
| **ACP (Agent Client Protocol)** | One generic driver for Gemini CLI, OpenCode, Grok CLI, and others |
| **@modelcontextprotocol/sdk** | MCP client hub (Composio, REA, user servers) and Brot's own MCP server |
| **Composio SDK** | 500+ app connectors with managed OAuth on day one |
| **OpenTelemetry** | Traces for runs and tool calls. Export anywhere |
| **libsodium** / OS keychain (`@napi-rs/keyring`) | Secrets at rest |

## Frontend (`apps/web`, `packages/ui`)
| Choice | Why |
|---|---|
| **React 19 + Vite** | Ecosystem, speed |
| **TanStack Router + Query** | Type-safe routes, cache that works well with SSE invalidation |
| **Tailwind CSS v4** | Tokens as CSS variables (see DESIGN.md) |
| **Radix UI primitives** (shadcn-style, owned in `packages/ui`) | Accessible primitives, our own skin |
| **Motion** (framer-motion) | Micro-interactions, mascot reactions |
| **Rive** (or Lottie fallback) | Mascot state machine with 20+ expressions |
| **noVNC** → **WebRTC** later | Live computer view |
| **Shiki** | Code/diff rendering in tool cards |
| **i18next** | en, pt-BR, es |

## Desktop & mobile
| Choice | Why |
|---|---|
| **Electron** (+ electron-builder, auto-update) | We embed a Node server, and Cua/native modules are Node-friendly. Tauri would force a Node sidecar anyway. Revisit if bundle size hurts |
| **Expo (React Native)** | iOS + Android from one codebase. Shares `packages/protocol` |

## Infra
| Choice | Why |
|---|---|
| **Docker** sandbox image (`images/computer`) | Default computer for desktop and self-host |
| **Firecracker** (Fly Machines first, then own metal) | Per-bot microVMs with snapshot/suspend for cheap always-on |
| **Postgres 16 + pgvector** | Single stateful dependency for self-host teams |
| **S3-compatible** (MinIO/R2) | Attachments, recordings, backups |
| **Helm chart + docker-compose** | Self-host targets |
| **Stripe** (Billing + Meters) | Subscriptions plus usage-based compute and credits |
| **Cloudflare** (DNS, R2, Turnstile, Tunnel for relay) | Cheap, global edge |
| **Sentry** (opt-in) / OTel collector | Errors and traces |

## Web properties
| Choice | Why |
|---|---|
| **Astro** for `apps/site` | Fast marketing pages, MDX, islands for mascot demos |
| **Astro Starlight** for `apps/docs` | Search, i18n, versioning built in |

## Explicitly *not* now
- **Redis/Kafka**: Postgres (pg-boss + LISTEN/NOTIFY) is enough until proven otherwise.
- **Kubernetes for self-host minimum**: Compose must stay the happy path.
- **Our own connector OAuth apps**: Composio until scale justifies native connectors (P2).

# Product Spec

## Vision

**Brot is an AI team that never clocks out, and you own the bakery.**
Bots with a job, a model, a computer, and your apps. They work in a chat you already know how to use. Run it on your laptop or your own server, or let **Brot Cloud** keep the oven hot 24/7.

## Principles

1. **Own your stack.** Everything the cloud does, a self-hoster can do. No feature is held back on purpose. Cloud sells *convenience* (always-on, managed sandboxes, billing, backups, support).
2. **One bot, one sandbox.** Isolation is the default, not an upgrade.
3. **Glass box.** Every memory, skill, tool call, and approval can be inspected, edited, and exported.
4. **Bring any brain.** Model-agnostic: subscription CLIs, API keys, or local models.
5. **Humans hold the keys.** Risky actions pause for approval. Credentials never enter the model context.
6. **Evidence over vibes.** Bots cite sources. REA teardowns show evidence and limits.

## Personas

| Persona | Need | Hook |
|---|---|---|
| **Solo founder / indie hacker** | Sales follow-ups, support triage, SEO, bookkeeping | "A team for $0 + your own model keys" |
| **Small agency / SMB (2–20)** | Shared bots, shared apps, audit trail | Team workspace on Brot Cloud |
| **Developer / product engineer** | Bug fixing, PR review, competitor teardowns | REA teardown → engineer bot builds it |
| **Privacy-conscious / regulated** | Data can't leave infra | Self-host via Docker/Helm, local models |
| **Homelabber** | Runs everything on own box | One-command `docker compose up` |

## Core concepts (domain glossary)

- **Workspace**: the tenant. It holds members, bots, apps, secrets, and billing.
- **Bot**: `{ persona, job, engine+model, computer, apps, skills, memory, policies }`.
- **Engine**: the agent runtime. Brot uses the DeepSeek Harness (DSH) for every bot; the bot picks a provider and model inside it.
- **Computer**: where a bot acts. Options are `host` (your machine), `sandbox` (local Docker/VM), and `cloud` (Brot Cloud microVM).
- **Thread**: a conversation (DM with a bot, or a **Room** with several bots and humans).
- **Run**: one unit of autonomous work inside a thread. It has steps, tool calls, cost, and an outcome.
- **Skill**: a portable `SKILL.md` folder (compatible with the Agent Skills format) with steps, decision rules, and approval boundaries.
- **Routine**: a trigger (cron, webhook, app event, file change) plus an instruction for a bot.
- **Approval**: a paused action waiting for a human. Choices are Allow once, Allow always (creates a policy), Deny, or Reply.
- **Team**: a shareable Markdown bundle of bots, skills, routines, and room setup.
- **Teardown**: a REA-powered reverse-engineering report with evidence.

## Feature map

Priority: **P0** = MVP (first public release), **P1** = v1 (Cloud GA), **P2** = later.

### A. Chat & bots
| # | Feature | P |
|---|---|---|
| A1 | Messaging-app layout: bot list (sidebar) → thread → context panel | P0 |
| A2 | Create a bot from a role template or from scratch (name, job, instructions, avatar) | P0 |
| A3 | Role library: Chief of Staff, Sales Follow-up, Support Triage, Recruiter, Bookkeeper, SEO Growth, Bug Fixer, Researcher, **Product Detective (REA)**, Competitor Watch | P0 (5), P1 (rest) |
| A4 | Streaming responses with collapsible tool-call cards and a step timeline | P0 |
| A5 | Pin, unread, duplicate, archive, delete, search | P0 |
| A6 | Switch model mid-thread. Unavailable engines are dimmed with the reason | P0 |
| A7 | **Rooms**: 2–N bots plus humans. Responder rules (mention, auto-router, lead bot) | P1 |
| A8 | Bot-to-bot handoff with ownership transfer and a visible "baton" | P1 |
| A9 | Attachments (files, images, screenshots), drag to the computer | P0 |
| A10 | Slash commands (`/skill`, `/teardown`, `/routine`, `/handoff`) | P1 |
| A11 | Voice: dictation, TTS replies, live call with a bot | P2 |

### B. Engines & models
| # | Feature | P |
|---|---|---|
| B1 | One runtime: **DeepSeek Harness (DSH)** over ACP. Brot drives DSH sessions and routes its permission prompts to the broker | P0 |
| B2 | Providers through DSH: DeepSeek, Anthropic API, OpenAI, OpenRouter, OpenAI-compatible and local endpoints, plus the sign-ins DSH supports natively (e.g. ChatGPT/Codex OAuth) | P0 |
| B3 | Provider setup UI (keys go to the vault, DSH receives `secret://` references) | P1 |
| B4 | Never route a subscription whose terms forbid third-party use (Claude Free/Pro/Max OAuth) | P0 |
| B5 | Per-bot model, temperature, budget caps (tokens/$ per run/day) | P0 caps, P1 rest |
| B6 | Fallback chain when a provider hits rate or usage limits (fixes the Grok Bot swarm stall) | P1 |
| B7 | Cost and usage meter per bot, run, and workspace | P0 |

### C. Computers
| # | Feature | P |
|---|---|---|
| C1 | `host` computer: control this machine (opt-in, Cua driver) | P1 |
| C2 | `sandbox` computer: local Docker image `brot-computer` (Ubuntu + XFCE + Chromium + dev tools + REA) | P0 |
| C3 | `cloud` computer: Firecracker microVM on Brot Cloud, one per bot, persistent disk | P1 |
| C4 | Live screen preview in the context panel (noVNC → WebRTC later) | P0 |
| C5 | **Take over**: the human drives for logins, 2FA, and CAPTCHA. The bot never sees typed secrets | P0 |
| C6 | Shared folders between bots, explicit and per-room | P1 |
| C7 | Snapshots and restore of a computer | P2 |
| C8 | Android device/emulator computer (adb) | P2 |

### D. Apps & tools
| # | Feature | P |
|---|---|---|
| D1 | Composio connector marketplace (Gmail, Slack, GitHub, Notion, Linear, HubSpot, Stripe, Sheets…) | P0 |
| D2 | Bring your own MCP server (stdio, local HTTP, remote). **Private MCP works without being public** | P0 |
| D3 | In-chat "connect app" prompt when a bot needs one | P0 |
| D4 | Per-bot app scopes (bot X can read Gmail but not send) | P1 |
| D5 | Native connectors for top 5 (Gmail, Calendar, Slack, GitHub, Google Drive) to cut Composio dependency | P2 |

### E. Autonomy: routines, triggers, skills
| # | Feature | P |
|---|---|---|
| E1 | Routines in plain language ("every weekday 9am, triage support inbox") → cron spec, confirmed by the user | P0 |
| E2 | Webhook triggers with signed secret URLs | P0 |
| E3 | App-event triggers (Composio events, GitHub, Stripe) | P1 |
| E4 | Calendar view of routines and runs | P1 |
| E5 | Skills: create, edit, version, import, and export `SKILL.md` | P0 |
| E6 | "Save this as a skill" after a successful run | P0 |
| E7 | **Teach by demonstration**: record a browser workflow in the computer → draft skill → test run | P1 |
| E8 | Goals / long-running missions with checkpoints and progress reports | P2 |

### F. Memory & knowledge
| # | Feature | P |
|---|---|---|
| F1 | Per-bot memory: facts, preferences, past-work summaries. **Every memory is visible, editable, deletable, and exportable** | P0 |
| F2 | Workspace memory (shared facts: company, products, tone) vs. bot memory | P1 |
| F3 | Knowledge sources: upload docs, sync a Drive/Notion folder, with citations in answers | P1 |
| F4 | Memory provenance: which run created it, with a link | P1 |

### G. Safety, approvals, governance
| # | Feature | P |
|---|---|---|
| G1 | Approval cards: shell, file write outside the workspace, send/publish, delete, purchase, permission change | P0 |
| G2 | Policies: "allow always" rules per bot, tool, and argument pattern. Editable in Settings | P0 |
| G3 | Secrets vault: OS keychain on desktop, libsodium-sealed in server mode. Bots get **short-lived references**, never raw values in the prompt | P0 |
| G4 | Audit log: every tool call, approval, and app action, with export | P1 |
| G5 | Roles: owner, admin, member, viewer. Per-bot sharing | P1 |
| G6 | Auto Review: a second model reviews risky actions before they reach the human | P2 |
| G7 | SSO/SAML, SCIM, data retention policies | P2 (Enterprise) |

### H. REA: Teardowns (differentiator)
See [REA-INTEGRATION.md](./REA-INTEGRATION.md).
| # | Feature | P |
|---|---|---|
| H1 | REA preinstalled in every `brot-computer` image, exposed as MCP to bots | P0 |
| H2 | **Product Detective** role template | P0 |
| H3 | `/teardown <url|file|apk>` → Teardown report: findings, evidence cards, limitations | P1 |
| H4 | "Build this" handoff: teardown → engineer bot opens a PR in your repo | P1 |
| H5 | Competitor Watch: scheduled re-teardown of competitor web bundles with a diff ("they shipped X") | P1 |
| H6 | Authorization gate plus responsible-use acknowledgement per teardown | P0 |
| H7 | Provider config: Ghidra bundled in cloud image. Hopper/IDA BYO license | P2 |

### I. Surfaces
| # | Feature | P |
|---|---|---|
| I1 | Web app (PWA) served by the Brot server | P0 |
| I2 | Desktop app (macOS, Windows, Linux) with embedded server | P0 |
| I3 | Headless `brot` CLI: `brot serve`, `brot run`, `brot team apply`, `--json` | P0 |
| I4 | Brot as an MCP server (bounded: no approvals, no secrets, no deletion) | P1 |
| I5 | Mobile app (iOS + Android, Expo): inbox, approvals, chat, live computer view, push notifications | P0 |
| I5b | **Pairing**: scan a QR code on desktop or Cloud to control those bots from your phone (see [REMOTE-CONTROL.md](./REMOTE-CONTROL.md)) | P0 |
| I5c | Multi-host: one phone controls bots on several machines plus Cloud, with a host switcher | P1 |
| I6 | Approvals from Slack/Telegram/email (approve from anywhere) | P1 |
| I7 | Public REST + webhooks API with TypeScript SDK | P1 |

### J. Teams & sharing
| # | Feature | P |
|---|---|---|
| J1 | Export/import a Team as Markdown (`team.md` + skills folder) | P1 |
| J2 | Community **Team Gallery** (brot.dev/teams) | P2 |
| J3 | Org library of private templates | P2 |

### K. Cloud-only (the business)
| # | Feature | P |
|---|---|---|
| K1 | Sign up → workspace provisioned in under 60s | P1 |
| K2 | Stripe billing: plans, usage-based compute, credits, trials | P1 |
| K3 | Brot Credits: run without your own keys, billed at cost plus margin | P1 |
| K4 | Backups, point-in-time restore, region choice (US/EU) | P1 |
| K5 | **Connect self-hosted to Cloud** (relay for webhooks and mobile push without opening ports) | P2 |
| K6 | One-click deploy templates (Railway, Render, Coolify, Fly, DigitalOcean) | P1 |

### L. Quality & trust
| # | Feature | P |
|---|---|---|
| L1 | Public eval suite (`evals/`) with published task-success rates per engine | P1 |
| L2 | Onboarding: first bot doing real work in under 3 minutes | P0 |
| L3 | i18n (en, pt-BR, es first) | P1 |
| L4 | Opt-in, anonymous telemetry. Off by default in self-host | P0 |

## MVP definition (P0 slice)

"A solo founder installs Brot (desktop or `docker compose up`), creates a *Support Triage* bot on DeepSeek V4 through DSH, connects Gmail through Composio, watches it work in a sandboxed computer, approves a reply, saves the flow as a skill, and schedules it every morning."

Success metrics: time to first useful run under 3 min, D7 retention of 35% or more, and an approval rejection rate under 15% (a proxy for trust).

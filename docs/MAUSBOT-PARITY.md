# MausBot parity

Reference product: [OpenMausBot](https://github.com/milind-soni/OpenMausBot) v0.1.121
(Apache-2.0), installed at `/Applications/OpenMausBot.app`, data in `~/.openmausbot`, source read from
a shallow clone. This file records what "work like MausBot, better" means concretely, how the gap was
measured, and the order in which Brot closes it. Update the status column at the end of every wave.

## How the gap was measured

1. **Docs recon** (`/tmp/recon-mausbot-docs.md`, 2026-10-22): README, all 46 `docs/*.md`, `docs/specs`,
   `docs/plans`, `docs/requirements`, `docs/superpowers`, `docs/verification` and the product docs in
   `apps/docs/content`. 17 capability areas, each with its data model, UI surface, routes and known
   limits.
2. **Installed-app evidence** (2026-10-22, read-only): the running harness on `127.0.0.1:8799`, its
   bundle, `config.json` (flags only, no secrets) and `bots.json`.
   The person's own workspace: **34 bots across 7 teams/sections** (Redes Sociais 8, Crescimento Fio 7,
   Promoções 5, Open Source 5, Influencers IA 5, Compras 3, Administração 1) ·
   **33/34 bots have the browser on, across 5 login profiles** (Gustavo shared 20, promoções 5, Lia 4,
   compras 3, umdia_br 1) · **Composio on for 19 bots, off for 6** · notifications on for 34/34 ·
   auto-approve off for 34/34 · models: 28× `opencode-go/deepseek-v4.1-flash`, 5× Claude Haiku 5.5,
   1× Claude Opus 5.5 · per-team working folders (`bot.cwd`: `~/Projetos/promocoes`,
   `~/Projetos/open-source`) · decision model (OpenRouter) enabled · automatic recovery with a fallback
   model · local VM mode, 4 instances max · mobile/companion configured.
3. **Brot inventory**: packages `protocol`, `db`, `engines`, `ui`; apps `server`, `web`, `desktop`,
   `mobile`, `site`, `cli`, `relay`, `evals`; server routes in `apps/server/src/app.ts`; tools in
   `apps/server/src/mcp`, `team`, `desktop`; 1229 tests.


### What the person actually uses (the priority signal)

From the running harness and `~/.openmausbot` (read-only, 2026-10-22):

| Signal | Value | Implication |
|---|---|---|
| Bots | 34 in 7 teams/sections | Teams and a large roster come before rooms |
| Conversations | 253 threads (max 42 on one bot) | Multiple independent threads per bot are daily use |
| Group chats | 0 | Rooms are not the shape this user needs; teams + DMs are |
| Routines | 26 (23 enabled), 61 runs | Automation is core, not a nice-to-have |
| Browser | 33/34 bots, 5 login profiles, 7 profile dirs | Browser is the single most used tool |
| Memory | 152 files / 598 KB, 201 team facts, 1,058-line journal, auto-recall on | Memory is a core product surface |
| Skills | 12 across 10 workspaces | Skills are used but lighter than memory |
| Attachments | 98 files, 46 MB | Chat needs files and images |
| Notifications | 327 | Interruption policy matters |
| Composio | Gmail, LinkedIn, GitHub (19 bots flagged) | A few connectors, not a marketplace |
| Models | 895 turns, US$ 39.49 metered, 761 on OpenCode Go | Cheap-first model routing and cost visibility matter |
| Computers | Docker Local VM per bot (1 running, max 4) | The Docker path Brot already has is the right one |
| Cloud/webhooks/triggers | none | Skip cloud and app-event triggers for now |

## Where Brot is deliberately different (and why it is better)

| MausBot | Brot | Why |
|---|---|---|
| Three CLI engines (Claude, Codex, Grok) plus ACP/API providers | One runtime, DeepSeek Harness over ACP, any provider/model | One permission model, one event stream, one place to fix bugs; no subscription-OAuth grey areas |
| Engine CLIs run on the host and own their sandboxing | Every bot's tools run in its own container or the host browser, with an explicit egress policy | Containment is an invariant, not a per-engine property |
| Full access is the default approval level | Ask by default; `allow always` creates a policy row | Approval-first is the product promise; MausBot itself is moving hosted workspaces to Ask |
| Untyped wire shapes in parts of the harness | One zod contract (`packages/protocol`) every layer validates | A bad payload fails at the boundary, not in the model prompt |
| Cost visibility mostly per message | Cost and tokens per run, per bot and per chain, from the relay | Efficiency is a product feature |
| Plaintext keys in `config.json` | AES-256-GCM vault, `secret://` references, relay injects keys | Secrets never enter model context |

## Capability matrix

Legend: ✅ parity or better · 🟡 partial · ❌ absent · 🎯 current wave.

| Area | MausBot | Brot today | Plan |
|---|---|---|---|
| Roster of bots, one thread per bot, pin/unread/archive | ✅ | ✅ | — |
| Multiple independent threads per bot | ✅ | ✅ any number, thread header + list, per-thread model override | W2 done |
| Groups/rooms with per-bot state, holds, usage badge | ✅ | ✅ rooms with responders, task board, rename and deletion | W3 |
| Teams: named section, shared instructions, roster, Chief | ✅ | ✅ teams with brief, chief and roster | W2 done |
| Per-team working folder (`bot.cwd`) | ✅ | 🟡 sandbox `/workspace` per bot; host computer has the real cwd | W2 |
| Browser per bot, persistent login profiles | ✅ | ✅ per-bot and shared profiles, persistent logins, egress-gated | W1 done |
| Live browser view and take-over | ✅ | ✅ JPEG live panel with click/scroll/type input and takeover for host browsers | W7 done |
| Host browser (My Chrome) attach | ✅ | ❌ | W5 |
| Saved logins vault + `fill_login` | ✅ | ✅ vault-backed logins with a Settings UI, host-gated fill_login with TOTP | W7 done |
| Connected apps (Composio marketplace) + per-bot tool grants | ✅ | ❌ | W3 |
| Custom MCP servers (stdio/HTTP, per-bot) | ✅ | ✅ stdio/HTTP servers with vault secrets, handshake test and Settings panel; per-bot grants pending | W5 done |
| Approval levels per bot/thread + decision log | ✅ | 🟡 per-bot ask/edits modes with an irreversible safety floor; decision log/export next | W6 |
| Routines: cron/weekday with timezone, receipts, recovery, calendar | ✅ | ✅ runs, receipts, catch-up, timezone, routines page; calendar next | W3 done |
| Webhook triggers | ✅ | 🟡 receiver exists, no signed secret UX | W6 |
| App-event triggers | ✅ | ❌ | W6 |
| Memory: MEMORY.md + topics + recall + upkeep + journal/undo + About me | ✅ | 🟡 recall, caps, bot editor and About-me workspace facts are live; journal/upkeep next | W4 |
| Skills: SKILL.md import/export, per-bot on/off, learned-skill approval | ✅ | ✅ SKILL.md import/export in the UI with prompt budgets; learned-skill review next | W4 |
| Voice: TTS providers, spoken replies, voice notes, calls, dictation | ✅ | 🟡 system and OpenAI-compatible TTS, listen button, per-bot auto-speak; calls/voice notes/dictation next | W8 |
| Message search across threads | ✅ | ✅ GET /api/search and the sidebar Messages section | W8 done |
| Attachments: images/screenshots/files in transcript, quota | ✅ | ✅ composer, transcript gallery, storage, text-in-prompt and orphan sweep | W6 done |
| Notifications: in-app/desktop, per-bot, exact-thread routing | ✅ | ✅ inbox, unread badge, native banners, per-bot toggle | W6 done |
| Analytics: usage ledger, decision log, admin activity, Today page | ✅ | ✅ Insights page (Today + usage + CSV); decision log and admin activity next | W8 |
| Team sharing: `.md`/package import-export, presets, org library | ✅ | ✅ Markdown package export/import with preview in Settings; presets and org library next | W9 |
| Remote access: pairing, browser client, phone PWA, companions | ✅ | 🟡 mobile app + relay, loopback trust only | W10 |
| Self-hosting: Docker, VPS, tunnel, backups | ✅ | 🟡 Docker + compose; no tunnel/backups | W10 |
| Cloud (Boat), Team Cloud, enterprise/SSO | ✅ | ❌ out of scope for now (backlog: Brot Cloud) | later |
| Multi-engine CLIs and custom ACP providers | ✅ | ❌ deliberate (DSH only) | — |

## Waves

Ordered by the usage evidence above, cheapest visible value first. Each wave ships green tests, a real
end-to-end run on this machine, and its own commit on `main`.

- **W1 — Browser with a persistent profile (done).** A bot gets `browser: true` and a Chrome on the
  server machine with its own profile under `~/.brot/browser-profiles/<botId>`, reached over CDP. Bot
  browsing goes through the bot's egress policy via the existing HTTP CONNECT proxy; the headed login
  window is unproxied because the person drives it. Bots with a desktop container keep that browser, and
  its Chromium profile now lives on the workspace volume, so logins survive a container restart.
- **W1b — Browser view.** Live frames and take-over for the host browser, idle stop, profile sign-out and a signed-in-sites list.
- **W2 — Teams and threads (done).** Named teams with shared instructions, a roster, a sidebar section and one
  Chief; several independent threads per bot with their own transcript, model override and cost; a working
  folder per bot/team (the reference's `bot.cwd`).
- **W3 — Routines (done).** Plain-language schedule to cron with confirmation, timezone, run receipts, history and
  calendar, catch-up and recovery rules, result posted into the bot's thread.
- **W4 — Memory and skills (prompt + recall done; web editors next).** Skills end to end (they are dormant today: `RunContext.skills` is ignored by
  the prompt and the web tab is empty), file-based memory with recall, upkeep, journal/undo and About-me
  facts.
- **W5 — Apps and MCP (bring-your-own MCP servers done; marketplace/native connectors and the settings UI next).** User MCP servers (stdio + HTTP, test handshake, per-bot grants, secret headers)
  and the first native connectors (Gmail, LinkedIn, GitHub), with per-bot scopes.
- **W6 — Chat parity.** Attachments (images/files/screenshots, preview, quota), approval levels and
  question cards with a decision log, notifications with exact-thread routing, unread and search.
- **W7 — Logins.** Saved-logins vault, sign-in cards, `fill_login`, attached "My Chrome", signed-in-sites
  list with sign-out.
- **W8 — Insight.** Usage ledger and CSV, decision log, a Today page of finished work, and the decision
  model for room routing.
- **W9 — Sharing.** Team packages, presets, import/export, the community formats.
- **W10 — Anywhere and voice.** Per-device sessions instead of loopback trust, a browser client and phone
  PWA, backups, TTS replies and voice notes (low usage evidence today, so last).

## Non-goals (for now)

Cloud computers and Team Cloud tenancy, enterprise licensing/SSO, org-library update channels, Grok Bot
import, APNs push, two-way Files sync, and the multi-CLI engine matrix. Brot's answer is the single DSH
runtime plus containers and provider keys; revisit only with evidence.

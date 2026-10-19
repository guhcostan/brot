# BUSINESS.md — Model, licensing, pricing

## Thesis

Grok Bot proved the demand (always-on AI teammates with their own computer). MausBot proved the open-source + hosted business shape. **Brot** wins by being the one that (a) you can truly self-host and own, (b) isolates each bot and lets you inspect/edit its memory, (c) runs any model, and (d) can actually *act on the web* and reverse-engineer software. We sell **convenience and trust**, not access.

## Licensing (open-core)

| Part | License | Rationale |
|---|---|---|
| `apps/*`, `packages/*` (the core product) | **AGPL-3.0** | Strong copyleft: anyone can self-host and modify, but a competitor can't run a closed SaaS fork without contributing back. This is our main defense against being cloned into a closed hosted product — the exact risk of a permissive (Apache) license |
| `cloud/` (control plane: billing, metering, provisioning, relay backend) | **Source-available / proprietary** (BSL-style, converts to Apache after 3 years) | The hosting-specific code that makes Brot Cloud a business. Deleting it still leaves a fully working self-host edition |
| `packages/protocol`, `packages/sdk`, `teams/*` | **Apache-2.0 / MIT** | Maximize adoption of the event protocol, the client SDK, and community teams/skills |

- A **CLA** (or DCO) governs contributions so we can offer commercial licenses.
- A **commercial license** of the AGPL core is available for companies that want to embed Brot without AGPL obligations.
- Trademark: "Brot" and the mascot are reserved; the code is open, the brand is not (standard open-core split).

## Who pays, and for what

Self-hosters pay nothing to us and bring their own model keys. Revenue comes from removing operational pain:

### 1. Brot Cloud (primary revenue)
Always-on hosted workspace: managed per-bot microVMs, no laptop-sleep problem, backups, team seats, mobile push and webhooks with no port-forwarding, and support.

| Plan | For | Includes (illustrative — validate before launch) |
|---|---|---|
| **Free** | trying it | 1 bot, 1 computer, limited compute-minutes, community support |
| **Baker** (solo) | indie / founder | a few always-on bots, a pool of compute-minutes, routines, mobile, email support |
| **Bakery** (team) | 2–20 people | seats, shared bots/apps/memory, roles, audit log, more compute, priority support |
| **Enterprise** | regulated / larger | SSO/SAML, SCIM, dedicated pods, region pinning (US/EU), DPA, retention controls, SLA |

- **Trial**: 3-day free trial with a small credit (mirrors MausBot), card required, first charge day 4, one per person.
- Two cost levers to protect margin: **BYO model keys** (you pay your provider) vs. **Brot Credits** (we proxy the model, billed at cost + margin), and **microVM suspend-on-idle** so an "always-on" bot costs us almost nothing while waiting.

### 2. Compute & credits (usage-based)
Compute-minutes for cloud computers and Brot Credits for model usage, metered via Stripe Meters. Transparent, in-app meter (feature B7).

### 3. Relay add-on
Self-hosters who want mobile push + inbound webhooks without exposing ports can pay for the hosted **Relay** (see [`REMOTE-CONTROL.md`](./REMOTE-CONTROL.md)). Low price, high convenience, keeps self-hosters in our ecosystem.

### 4. Later (P2+)
- **Team Gallery** marketplace with paid premium teams/skills (rev-share).
- **Managed connectors** / enterprise connector packs.
- Hardware ("oven" mini-PC) only if there's pull — low priority.

## Go-to-market

- **Open source first.** A genuinely great free self-host app earns GitHub stars, Discord members, and trust. This is the top of funnel (MausBot's playbook).
- **Wedge features** that demo in 60 seconds and that competitors lack: "watch a bot build your cart and wait for your approval", "point a bot at a web app and get an evidence-backed teardown", "control your bots from your phone on the subway."
- **Channels**: Discord community, X/LinkedIn build-in-public, a comparison page (vs Grok Bot, vs MausBot), docs SEO, and a Team Gallery for virality.
- **Conversion**: the self-host → Cloud upsell is the laptop-sleep moment ("Move this bot to Cloud").

## Moat & risks

| Moat | |
|---|---|
| AGPL + proprietary control plane | blocks closed hosted forks |
| Per-bot isolation + editable memory | hard to retrofit into competitors; trust feature |
| REA teardowns | unique capability, defensible workflow |
| Protocol/SDK/teams ecosystem | network effects |

| Risk | Mitigation |
|---|---|
| A big lab ships this for free | stay model-agnostic, own self-host + privacy, move fast on web-action reliability |
| Compute margins | suspend-on-idle microVMs, BYO keys default |
| Account/web-action abuse | strict guardrails (own accounts only, no protection-circumvention, human takeover) — see [`BROWSER-AGENT.md`](./BROWSER-AGENT.md) and [`SECURITY.md`](../SECURITY.md) |
| Provider ToS for social posting | official APIs first; UI automation is for the user's own accounts and pauses on challenges |

> Numbers in the plan table are placeholders to be validated with pricing research and unit-economics modeling before any public commitment.

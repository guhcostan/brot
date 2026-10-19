# Web Actions: how bots act on the web for you

**Goal.** Bots do real tasks for the user: shop (build a cart, reach checkout), manage the user's own accounts, and publish to social networks (X, Instagram, TikTok, LinkedIn, YouTube), including video uploads. The design goals are: reliable, auditable, and always under the user's control.

## Guardrails (read first)

Brot acts only on **the user's own accounts**, with the user's own credentials, on tasks the user explicitly asked for. Two hard rules shape the whole design:

1. **We do not circumvent site protections.** When a site shows a CAPTCHA, a 2FA prompt, an identity check, or an "unusual activity" page, the bot **stops and hands the step to the human** (see "Human takeover"). It does not attempt to bypass, spoof, or defeat bot-management systems.
2. **Nothing irreversible happens unseen.** Payments, purchases, posts, sends, and deletions always pause for an approval (see [`REMOTE-CONTROL.md`](./REMOTE-CONTROL.md) for approving from your phone).

These rules keep the user's accounts safe and keep Brot Cloud compatible with site terms of service.

## Channel priority: sturdiest path first

The planner chooses, per step, the most robust channel available and records the choice in the run log.

1. **Official API / first-party connector.** X API, Instagram Graph API (Business/Creator), TikTok Content Posting API, LinkedIn Marketing API, YouTube Data API, and e-commerce storefront APIs where the user has access. Sanctioned and stable; survives UI changes.
2. **MCP / Composio tool.** When the app is already covered by a connector, with managed OAuth and scoped permissions.
3. **Real browser with the user's own session.** When no API covers the task, the bot drives a real browser profile where the *user* has logged in. The bot navigates, fills forms, and assembles a cart like a careful human would.
4. **Human takeover.** When a site challenges the session, the bot pauses the run and notifies the user, who completes that one step (sign-in, 2FA, CAPTCHA) and hands control back. The bot resumes from where it left off.

## Social publishing (P0)

`packages/tools/publish` exposes a single `publish` capability with per-network adapters built on each platform's **official API**:

- **Text / image / link posts** and threads.
- **Video / Reels / Shorts uploads** via each platform's resumable upload + publish endpoints (async job → poll → confirm).
- **Scheduling**: a post can be handed to a routine (see Autonomy in [`PRODUCT.md`](./PRODUCT.md)).
- Each network adapter declares its own auth scopes, media constraints (length, aspect ratio, size), and rate limits, surfaced to the bot so it fails early with a clear message instead of a rejected upload.

A "Publish" approval card previews the exact content (caption, media thumbnail, target account) before anything goes out.

## Shopping & account tasks (P1)

- **Cart / checkout**: via storefront APIs where available, otherwise a real browser on the user's session. The bot assembles the cart and stops at the payment/confirmation step for approval.
- **Payments**: the bot never reads full card numbers or CVCs from the model context. Payment details come from the browser profile's saved payment methods or the OS/password-manager autofill, under human confirmation. The approval card shows merchant, amount, and items.
- **Logins**: handled by the user's existing browser session or password manager. 2FA codes and identity checks are a human-takeover step; the bot never asks the model to produce or enter them.

## The browser itself

- The browser runs **inside the bot's computer** (the sandboxed `brot-computer`, or the user's host machine if they opted in). See [`ARCHITECTURE.md`](./ARCHITECTURE.md).
- **Playwright** drives a real Chromium with a persistent profile per `(bot, site-domain)`, so logins and cookies survive across runs and the user logs in once.
- Actions are **human-paced** (realistic timing, scrolling, and interaction) because that is how a person uses a site, not to deceive detection. The bot does not fabricate device identities or rotate fingerprints.
- The live browser is streamed to the chat and phone so the user watches in real time and can take over with one tap.
- A per-bot **egress allowlist** is available for regulated users (the bot may only reach approved domains).

## Reliability patterns

- **Prefer APIs** (channel 1/2) for anything that will run on a routine; UI automation (channel 3) is for one-off or uncovered tasks.
- **Idempotency**: publish and purchase actions carry an action key so a retry after a disconnect doesn't double-post or double-buy.
- **Self-check**: after a destructive step the bot verifies the result (order confirmation, post URL) and reports it with evidence in the run log.
- **Graceful stop**: on a challenge page or an unexpected layout, the bot stops and asks rather than guessing. A stalled run is always resumable.

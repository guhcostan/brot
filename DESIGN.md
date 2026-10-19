# DESIGN.md — Art Direction

> The master design reference. UI code implements these tokens; it does not invent new ones. The machine-readable source of tokens lives in `packages/ui/tokens`. This file explains the intent.

## 1. The idea

**Brot = BR + bot.** A team of AI bots, born in Brazil, built for the world. The name is the only overtly Brazilian thing on the surface: the product speaks **English first and ships multilingual** (en, pt-BR, es). The Brazilian soul shows up as *warmth and character*, not flags or clichés.

That character comes from **Brazilian wildlife**. Every bot is an animal with a temperament, so a "team of bots" reads as a little ecosystem of creatures you delegate to. Calm, clever, and alive, the opposite of cold enterprise dashboards and of chaotic "AI slop."

Three words guide every decision: **warm, trustworthy, quietly capable.**

- **Warm**, not corporate: natural light, earthy tones, rounded-but-crisp shapes, animal mascots with real personality.
- **Trustworthy**, because bots act on real accounts and money: generous spacing, legible type, honest state, visible approvals. Never dark-patterned.
- **Quietly capable**: the craft shows in restraint and motion, not in decoration. (A capybara is unbothered because it has everything handled.)

## 2. Mascots: the fauna system

The flagship mascot is **Capy, a capybara** — the calm, universally loved creature that anchors the brand (logo lockup, loading states, empty states, landing hero). Capy is the "chief of staff" of the ecosystem.

Beyond Capy, each **bot role maps to a Brazilian animal** whose nature fits the job. This is a product feature, not just decoration: when you create a bot, you pick (or it suggests) an animal that signals its temperament.

| Animal (en / pt) | Temperament | Default role |
|---|---|---|
| **Capybara** / capivara | calm, coordinating, unflappable | Chief of Staff (flagship) |
| **Jaguar** / onça-pintada | focused, decisive, precise | Bug Fixer / Executor |
| **Toucan** / tucano | communicative, outgoing | Sales Follow-up / Outreach |
| **Macaw** / arara | colorful, creative, loud | Social / Content & Posting |
| **Anteater** / tamanduá | sniffs things out, methodical | Researcher / Product Detective (REA) |
| **Pink river dolphin** / boto | navigates murky water | Web navigator / Browser tasks |
| **Sloth** / preguiça | patient, tireless in the background | Scheduled routines / Watchers |
| **Marmoset** / mico | quick, nimble, small jobs | Quick tasks / Triage |

- Style: **flat, rounded, geometric** illustrations with a 2px-feel soft line, friendly but not babyish. One consistent construction across the set (same eye style, same corner radius), so eight animals read as one family.
- Capy is built in `packages/mascot` as a **Rive** state machine (Lottie fallback) with 20+ expressions mirroring bot state. The other animals ship as a static illustrated set first, animated later.
- The mascot is a **status indicator**, not a gimmick: if it can't say something true about a bot, it doesn't animate.

| Bot state | Mascot behavior |
|---|---|
| Idle | calm, slow breathing |
| Thinking / working | eyes tracking, subtle activity |
| Needs approval | leans forward, gentle pulse, `--live` glow |
| Running on a schedule | small clock, content |
| Error / blocked | concerned, never alarmist |
| Success | subtle lift, warm glow |

## 3. Logo

- **Wordmark**: "brot" in lowercase **Fraunces**, warm and high-craft. The "o" is drawn as a subtle paw-print / seed dot — the one small signature that hints at the fauna idea without spelling it out.
- **Lockup**: wordmark + Capy's head mark. Capy alone is the app icon and favicon.
- Works in one color; the mark never requires the full illustration to be recognizable.

## 4. Color

Tokens on `:root`, with a dark theme. Inspired by Brazilian landscapes (cerrado clay, Atlantic-forest foliage, river water, sunset), kept tasteful and international, never the national flag's green-and-yellow.

### Brand
| Token | Light | Dark | Use |
|---|---|---|---|
| `--brand` | `#2E7D5B` | `#4FB488` | primary (Atlantic-forest green) — brand, primary actions |
| `--brand-ink` | `#18492F` | `#BFEAD4` | text/icon on brand surfaces |
| `--sun` | `#C8781E` | `#E8A24A` | secondary accent (sunset amber), highlights |
| `--live` | `#D14A32` | `#F0633F` | reserved for "needs you / live action" (approvals, takeover) |
| `--river` | `#2E6E9E` | `#6FB1D8` | info, links, the "water/navigation" accent |

### Neutrals (warm, never pure gray — "clay & sand")
| Token | Light | Dark |
|---|---|---|
| `--paper` (app bg) | `#FBF7F0` | `#14110D` |
| `--surface` (cards) | `#FFFFFF` | `#1E1A14` |
| `--surface-2` | `#F2ECE0` | `#272219` |
| `--line` | `#E7DDCB` | `#3A3227` |
| `--ink` (text) | `#241F18` | `#F3EEE2` |
| `--ink-2` (muted) | `#6A6153` | `#B2A892` |

### Semantic
`--danger #D14A32` · `--warn #C8781E` · `--ok #2E7D5B` · `--info #2E6E9E`.

### Rules
- **One accent per view.** `--brand` carries brand/primary actions; `--live` is reserved for things that need the human *now*. Overusing `--live` destroys its meaning.
- Every surface declares an explicit background. Dark mode is guarded both by `@media (prefers-color-scheme: dark)` under `:root:not([data-theme="light"])` and by `:root[data-theme="dark"]`.
- Contrast: all text meets WCAG AA (the `check:contrast` script in CI enforces it). Data-viz follows the `dataviz` palette, tuned to this warm set.

## 5. Typography

A three-face system. Self-hosted in the desktop app; the web may use Google Fonts for the same families.

| Role | Face | Why |
|---|---|---|
| **Display / headings** | **Fraunces** (variable, opsz + soft) | warm, high-craft serif; gives character without nostalgia |
| **UI / body** | **Inter** (variable) | neutral, legible workhorse for dense chat and settings |
| **Code / logs / diffs** | **JetBrains Mono** | tool-call output, teardown evidence, shell cards |
| **Numerals (metrics)** | Inter, `tabular-nums` | cost meters and counters don't jitter |

Type scale (1.200 on UI, 1.333 on marketing): `12 · 14 (base) · 16 · 19 · 23 · 28 · 37 · 50`. Line-height 1.5 for body, 1.15 for display. Headings use Fraunces with `font-optical-sizing: auto`.

## 6. Shape, space, motion

- **Radius**: `--r-sm 8 · --r-md 12 · --r-lg 18 · --r-xl 28`. Bubbles and cards are soft; inputs are crisp. Bot avatars are "rounded squircle," not circles, to read as *creatures/agents*, not human contacts.
- **Spacing**: 4px grid (`4 · 8 · 12 · 16 · 24 · 32 · 48 · 64`). Chat has air; this is not a trading terminal.
- **Elevation**: soft, warm-tinted shadows (`0 1px 2px rgba(36,31,24,.06)` → layered). No hard black shadows.
- **Motion** (Motion/framer): 120–200ms ease-out for UI; mascots use slow 2–4s loops. Respect `prefers-reduced-motion`: mascots fall back to static state icons.

## 7. Layout

Messaging-app frame, three panes (collapsible to one on mobile):
1. **Sidebar** — bots and rooms (animal avatars), status dots, pinned on top, search.
2. **Thread** — streaming messages, collapsible **tool-call cards** (shell, file diff via Shiki, browser step, teardown evidence), and inline **approval cards** (`--live`: Allow / Allow always / Deny / Reply).
3. **Context panel** — the bot's live **computer** (screen stream + Take over), plus tabs for Memory, Skills, Apps, Routines, Cost.

Mobile (Expo) reuses tokens: inbox → thread → approval sheet, with the live screen as a full-sheet view. See [`docs/REMOTE-CONTROL.md`](docs/REMOTE-CONTROL.md).

## 8. Voice & copy

- Plain, confident, kind. Short verbs. "Approve the payment?" not "Authorization required for financial transaction."
- Honest about state: "Sleeping · last seen 14:02", "Waiting for you", "Stopped — the site asked for a sign-in."
- Light, never cutesy: the fauna gives warmth, the copy stays professional. A touch of character in empty states ("Capy's got nothing to do yet") is fine; feature copy is straight.
- Never hype, never fake urgency. The only urgent color (`--live`) is earned by a real pending action.
- English first; keys live in `apps/web/locales` (en, pt-BR, es).

## 9. Accessibility (non-negotiable)

AA contrast everywhere, full keyboard navigation, visible focus rings (`--brand` at 2px), screen-reader labels on every tool-call and approval card, `prefers-reduced-motion` honored, and no meaning carried by color alone (icons + text accompany every status).

## 10. Landing site

The marketing site (`apps/site`) presents the project and drives two actions: **Download** (desktop / self-host) and **Start on Brot Cloud** (hosted). It leads with Capy and the fauna team, shows the chat UI in action, and makes the "yours vs. hosted" choice obvious. See the hero concept in the published landing page. Tone and tokens match this file; it is English-first with a language switcher.

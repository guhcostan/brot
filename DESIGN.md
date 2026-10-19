# DESIGN.md — Art Direction

> The master design reference. UI code implements these tokens; it does not invent new ones. The machine-readable source of tokens lives in `packages/ui/tokens`. This file explains the intent.

## 1. The idea

**Brot = BR + bot.** A team of AI bots, born in Brazil, built for the world. The product speaks **English first and ships multilingual** (en, pt-BR, es). The Brazilian identity lives in the **bots**: each one is a Brazilian animal with a name and personality. The chrome stays neutral: no flags, no tropical palette.

The interface is **minimal and neutral**, in the family of Grok and MausBot: grayscale surfaces, black primary actions, generous whitespace, and type doing the work. Color appears in exactly two places: the bot avatars, and the single attention color for things that need the human.

Three words guide every decision: **calm, trustworthy, quietly capable.**

- **Calm**: grayscale chrome, no gradients, no decoration. The content is the interface.
- **Trustworthy**, because bots act on real accounts and money: legible type, honest state, visible approvals. Never dark-patterned.
- **Quietly capable**: craft shows in spacing, alignment, and motion, not ornament.

## 2. Bot avatars: Brazilian animals, flat and bold

Every bot is the **head of a Brazilian animal**, built from a few flat geometric shapes in one saturated color, in the style of bold sticker-like mascots (reference: a flat koala head with round ears, a big grey nose, and ring eyes). No outlines, no gradients, no fur texture, no mouths. The color is a personality choice, not the animal's real color: a violet capybara is fine. Detail is limited to **one darker or lighter tone of the same color** (snout, ears, spots, beak) plus the eyes.

**Species** (`AvatarSpecies`): `capivara` (capybara: wide boxy head, small round ears, big flat snout) · `onca` (jaguar: round head, rounded ears, a few rosette spots) · `tucano` (toucan: round head, oversized curved beak) · `arara` (macaw: rounded head, hooked beak, a cheek patch) · `tamandua` (anteater: long tapering snout, small ears) · `boto` (pink river dolphin: dome head, long thin rostrum) · `preguica` (sloth: round face, darker eye mask bands) · `mico` (marmoset: small face, big ear tufts) · `lobo` (maned wolf: tall pointed ears, narrow snout) · `jabuti` (tortoise: shell-patterned dome with a small head).

**Colors** (`AvatarColor`, avatar-only, never in chrome): `black` · `teal` · `violet` · `blue` · `orange` · `amber` · `pink` · `brown` · `gray` · `white` (light grey `#E5E7EB` head with dark detail, like the reference koala). Values live in `packages/ui` tokens.

**Eyes** carry expression and keep the same construction across species: either two short strokes or two rings, white on dark colors and near-black on light colors (white, amber, gray). Moods:

| Bot state | Eyes |
|---|---|
| Idle | two short vertical strokes (or rings) |
| Thinking / working | eyes glance to one side |
| Needs approval | eyes slightly larger (wide awake) |
| Sleeping / scheduled | two short horizontal strokes (closed), slightly sleepy tilt like the reference |
| Error / blocked | strokes tilted inward (concerned), never alarmist |
| Success | two small upward arcs (smiling eyes) |

- **Encoding**: `bot.avatar` stores `"<species>:<color>"` (e.g. `"capivara:violet"`). Legacy shape values (`circle`, `squircle`, …) map to a species; unknown values fall back to a deterministic pick from the bot id.
- All species read at the same optical size and as one family: same eye construction, same corner softness, heads may slightly overflow the circle at small sizes.
- Group views (room headers, the site hero) may **overlap heads** like the reference, on `--bg`; in dark mode this is the signature look.
- The brand mark is the **black capybara** with idle eyes. Capy (chief of staff) is its default bot.

**Bots are alive.** Avatars animate continuously but quietly, so the team feels present without being noisy:

| Bot state | Motion |
|---|---|
| Idle | blinks at random intervals (every 3–7s, ~120ms), occasional slow glance left/right, very subtle breathing (scale 1 → 1.02, 4s loop) |
| Thinking / working | eyes scan side to side (~1.2s loop), blink less |
| Needs approval | eyes widen and look toward the approval card; one gentle bob every few seconds |
| Sleeping / scheduled | closed eyes, slow breathing (6s), no blinks |
| Error / blocked | eyes tilt inward, a single small shake on entering the state, then still |
| Success | quick happy hop (one bounce, ~300ms) and smiling eyes, then back to idle |

- State changes morph the eye strokes (stroke path / scale) rather than cutting.
- Eyes may follow the pointer when it hovers the avatar or nearby (e.g. the bot's sidebar row or the thread header).
- Each avatar gets a random phase offset so a list of bots never blinks in sync.
- Other UI that should feel alive: typing indicator as three dots pulsing in sequence, streaming text fades in per token chunk, new messages slide up 4–8px while fading in, the approval card enters with a short rise, and the send button gives a small press scale.
- Animate only `transform` and `opacity` (GPU-friendly); pause loops for offscreen avatars and in background tabs.
- `prefers-reduced-motion`: no loops, no blinks, no hops. Eyes switch shape instantly and entrances become plain fades.

- Avatars are the only saturated color on screen. They sit directly on the surface; no tile, no ring (except the focus ring).
- Ears, tufts and beaks may move a little with the mood (ears perk on approval, droop when sleeping), always as transform-only motion.

## 3. Logo

- **Wordmark**: "brot" in lowercase **Inter**, semibold, tight tracking (−0.02em).
- **Mark**: the black capybara head with two white eye strokes. It is the app icon and favicon.
- Works in one color; the mark and wordmark never need color to be recognizable.

## 4. Color

Grayscale chrome. Tokens live on `:root` with a dark theme. Pure white and near-black, never warm or tinted grays.

### Neutrals
| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` (app bg) | `#FFFFFF` | `#0A0A0A` | app background |
| `--surface` (cards, panes) | `#FFFFFF` | `#141414` | cards, side panes |
| `--surface-2` | `#F5F5F5` | `#1C1C1C` | hover, inputs, user bubbles, code |
| `--line` | `#E5E5E5` | `#262626` | borders, dividers |
| `--ink` (text) | `#0A0A0A` | `#FAFAFA` | primary text |
| `--ink-2` (muted) | `#525252` | `#A3A3A3` | secondary text |
| `--ink-3` (faint) | `#6F6F6F` | `#8A8A8A` | timestamps, placeholders (still AA on `--bg`) |

### Actions
| Token | Light | Dark | Use |
|---|---|---|---|
| `--primary` | `#0A0A0A` | `#FAFAFA` | primary button fill |
| `--primary-ink` | `#FFFFFF` | `#0A0A0A` | text on primary |
| `--focus` | `#0A0A0A` | `#FAFAFA` | 2px focus ring, 2px offset |

### Attention (the only chrome color)
| Token | Light | Dark | Use |
|---|---|---|---|
| `--attention` | `#DC2626` | `#EF4444` | approvals, errors, takeover: borders, dots, icons |
| `--attention-text` | `#B91C1C` | `#F87171` | attention text (AA on `--bg` and `--surface`) |
| `--attention-soft` | `#FEF2F2` | `#2A1212` | approval card background |

Success, info, and warning have **no color**: they use `--ink`/`--ink-2` with an icon and text.

### Rules
- **One color in chrome.** `--attention` is reserved for things that need the human now (pending approval, error, takeover). Overusing it destroys its meaning.
- Avatar colors never appear in chrome (no colored buttons, links, or badges).
- Every surface declares an explicit background. Dark mode is guarded both by `@media (prefers-color-scheme: dark)` under `:root:not([data-theme="light"])` and by `:root[data-theme="dark"]`.
- Contrast: all text meets WCAG AA (`tokens.test.ts` enforces it).

## 5. Typography

Two faces. Self-hosted (`@fontsource-variable`); no serif anywhere.

| Role | Face |
|---|---|
| **UI, headings, body** | **Inter** (variable) |
| **Code, logs, diffs, tool calls** | **JetBrains Mono** |
| **Numerals (metrics)** | Inter, `tabular-nums` |

Type scale: `12 · 13 · 14 (base) · 16 · 20 · 24 · 32 · 48`. Line-height 1.5 body, 1.2 headings. Headings use weight 600 and −0.01em to −0.02em tracking. Hierarchy comes from size and weight, not color.

## 6. Shape, space, motion

- **Radius**: `--r-sm 6 · --r-md 10 · --r-lg 14 · --r-xl 20 · --r-full 999`. Buttons and inputs `--r-md`; cards `--r-lg`; composer `--r-xl`; pills `--r-full`.
- **Spacing**: 4px grid (`4 · 8 · 12 · 16 · 24 · 32 · 48 · 64`). Chat has air.
- **Elevation**: flat by default; separation comes from `--line` borders. Only floating layers (menus, sheets, the composer) get a neutral shadow `0 1px 2px rgba(0,0,0,.04), 0 8px 24px rgba(0,0,0,.06)`.
- **Buttons**: `primary` (black fill), `secondary` (`--surface-2` fill, `--ink` text), `ghost` (transparent, hover `--surface-2`), `danger` (`--attention` outline + `--attention-text`; used only for Deny/Stop).
- **Motion**: chrome transitions are 120–180ms ease-out and never loop. Life comes from the bots (§2): blinking, glancing, breathing, and state reactions. Respect `prefers-reduced-motion`.

## 7. Layout

Messaging-app frame, three panes (collapsible to one on mobile):
1. **Sidebar**: bots and rooms with animal avatars, a status dot, pinned on top, search. Selected row uses `--surface-2`, never a color.
2. **Thread**: centered column (max ~720px). Bot messages are plain text without a bubble; user messages sit in a `--surface-2` bubble aligned right. Collapsible **tool-call cards** in mono, and inline **approval cards** (`--attention` border on `--attention-soft`: Allow / Allow always / Deny / Reply).
3. **Context panel**: the bot's live **computer** (screen stream + Take over), plus tabs for Memory, Skills, Apps, Routines, Cost. Tabs are text with an underline, not pills.

The composer is a single rounded field with a black circular send button.

Mobile (Expo) reuses tokens: inbox → thread → approval sheet, with the live screen as a full-sheet view. See [`docs/REMOTE-CONTROL.md`](docs/REMOTE-CONTROL.md).

## 8. Voice & copy

- Plain, confident, kind. Short verbs. "Approve the payment?" not "Authorization required for financial transaction."
- Honest about state: "Sleeping · last seen 14:02", "Waiting for you", "Stopped — the site asked for a sign-in."
- Light, never cutesy. Personality lives in each bot's name and voice; product copy stays straight. Empty states are one plain sentence ("No bots yet. Create one to get started.").
- Never hype, never fake urgency. The only chrome color (`--attention`) is earned by a real pending action.
- English first; keys live in `apps/web/locales` (en, pt-BR, es).

## 9. Accessibility (non-negotiable)

AA contrast everywhere, full keyboard navigation, visible focus rings (`--focus` at 2px), screen-reader labels on every tool-call and approval card, `prefers-reduced-motion` honored, and no meaning carried by color alone (icons + text accompany every status).

## 10. Landing site

The marketing site (`apps/site`) presents the project and drives two actions: **Download** (desktop / self-host) and **Start on Brot Cloud** (hosted). It leads with the overlapping animal heads on a dark band and a short promise, shows the chat UI in action, and makes the "yours vs. hosted" choice obvious. See the hero concept in the published landing page. Tone and tokens match this file; it is English-first with a language switcher.

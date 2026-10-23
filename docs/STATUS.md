# Build Status

Handoff notes for the next session. Update this file at the end of every wave.

_Last updated: 2026-10-22_

## How to resume

1. Read `AGENTS.md`. The rules are binding: the orchestrator delegates to Haiku workers, splits work by owned paths, and pushes to GitHub after each verified wave.
2. Run `pnpm install && pnpm typecheck && pnpm lint && pnpm test` to confirm a green baseline.
3. Start the next wave below.

Repo: https://github.com/guhcostan/brot (private).

## Done

| Wave | Package | State | Notes |
|---|---|---|---|
| 0 | root workspace | ✅ pushed (`62cee69`) | pnpm 10 + Turbo, `tsconfig.base.json`, oxlint, root vitest `test.projects` |
| 0 | `@brot/protocol` | ✅ pushed | zod 4. Entities, request bodies, `CanonicalEvent` union, `EngineDriver` contract, port constants |
| 0 | `@brot/db` | ✅ pushed | Drizzle 0.45 + libSQL. `createDb(url)` is **async**. `createRepos(db)` for every entity |
| 1A | `@brot/engines` | ✅ pushed | `mock`, `claude`, `codex` drivers. **Being replaced by a single `dsh` driver** (see In progress) |
| 1B | `apps/server` | ✅ pushed | Hono REST + SSE, harness, broker, scheduler, vault, device auth, pairing, webhooks |
| 2 | redesign `@brot/ui` + `apps/web` | ✅ pushed | Opus worker. Grayscale tokens, single `--attention` red, Inter + JetBrains Mono, `BotAvatar` (7 shapes, 9 colors, animated eyes per mood, blink scheduler, reduced-motion), `bot.avatar = "shape:color"` |
| 2 | web HTTP/SSE client | ✅ pushed | `createClient()` → HTTP client by default, mock with `VITE_BROT_MOCK=1`. Vite proxies `/api` to 8799 |
| 2 | `apps/cli` + `apps/relay` | ✅ pushed | `brot serve | doctor | run` with `--json`. Blind WebSocket relay (2 peers/channel, 1 MiB frames, idle timeout, no logging) |
| 2 | integration | ✅ pushed | `apps/server/src/e2e.test.ts` (approve + deny over real HTTP/SSE), `Dockerfile`, `deploy/compose.yaml`, `.github/workflows/ci.yml`. Docker build not run (daemon down) |

## Wave 3 (✅ pushed)

| Task | Owner | Notes |
|---|---|---|
| DSH engine over ACP | Haiku | `packages/engines`: `mock` + `dsh` only. Pins `@deepseek-ai/dsh@0.2.1-rc.2`, `@agentclientprotocol/sdk@1.4.0`. Launch `node <dsh>/lib/bin.js --profile acp`. One ACP process + session per thread (in memory), `session/resume` after restarts of the process. Handshake verified against real DSH with no keys |
| Electron shell | Haiku | `apps/desktop`: in-process server on an ephemeral port behind a loopback gateway on 8798 that serves `apps/web/dist` and proxies `/api`. GUI never launched |
| Expo app | Opus | `apps/mobile`: pairing (QR/paste), inbox, thread, approval sheet (Face ID before sensitive allows), settings. RN avatar reuses `packages/ui` geometry. Bundles for iOS/Android; never run on a device |
| Astro site | Opus | `apps/site`: en/pt-BR/es, living avatars as islands, static chat mock. Domain placeholder `https://brot.dev` (`SITE_URL`) |
| Locales + switcher | Haiku + Opus | pt-BR/es, sidebar language switcher without reload |
| Desktop title bar, avatar hydration | Opus | macOS drag strip via Electron UA detection; `BotAvatar` SSR-safe motion/phase |
| `LICENSE` | orchestrator | AGPL-3.0 |

## Wave 4 (✅ pushed: `7118f3c` contracts, `f549664` implementation)

Containment model in docs/ARCHITECTURE.md. Docker provider (internal network + per-bot egress sidecar proxy, hardened container, `images/computer`), host provider (desktop only), Brot MCP server at `/mcp/runs/:runId` (per-run 256-bit token, every call through the broker, secrets after allow; tools `http_request`, `notify_user`, `remember`), harness placement without fallback, persisted DSH sessions, `computer: none` runs DSH with a no-tools overlay. Seeded Capy is `computer: none`.

**Never exercised against a real Docker daemon** (it was down): build `images/computer` and `images/computer/egress.Dockerfile`, then run the 3 skipped real-daemon tests and a real egress check. Unverified: that DSH honours `HTTPS_PROXY` inside the container.

Known gaps: no `ComputerProvider.remove(botId)` (deleting a bot leaves its container/network/volume); no idle-stop `computer.status`; `network.blocked` can be attributed to the wrong thread when runs overlap; providers get `config.port` before listen (port 0 breaks the docker relay, tests inject providers); provider keys inside the computer (`computerEnv`) are readable by the agent: decide how DSH gets model keys; secret redaction is literal-only; run tokens of runs that never settle stay in memory.

## Wave 5: teams (✅ pushed)

Spec: docs/TEAM-API.md. Contracts `ac08dd8` (rooms, members, responder mode, `Message.authorBotId/mentions/viaBotId`, `thread_sessions`, `Task` with chains, events `task.*`/`handoff`/`bot.asked`/`bot.answered`/`room.members`), then:
- Server: rooms API, `@mention`/lead routing (sequential responders), per-bot DSH sessions, labeled history, tasks API (user task starts the assignee in its DM, `workRunId`, cancel stops the run), chain tracking and per-chain cost, `GET /api/threads/:id/events?after=`.
- Team MCP tools (`apps/server/src/team`): `list_team`, `ask_bot`, `delegate_task`, `update_my_task`, `handoff`. Guards: no self-target, ask cycles, hop/depth/chain-size limits, smallest `teamBudgetUsd` in the chain; result posted back and the delegator notified once.
- DSH driver keyed by (thread, bot); fixed a kill path that returned while the child was still a zombie.
- DB: WAL + busy timeout + an in-process write gate (libSQL is synchronous, so a pooled connection blocked the transaction holding the lock). Rule: inside `db.transaction` use only `tx`.
- Web (Opus): rooms in the sidebar, new-room dialog, `@mention` combobox, author per message, collapsible bot-to-bot rows with gaze, handoff baton, task board + context tab. Smoke-tested against the real server with the mock engine (mention routing, task to done).

Open: no UI to add/remove room members; baton is in memory (lost on restart); global SSE replay pages by timestamp and can skip same-millisecond events (needs an id cursor); `workRunId` set without `task.updated`; DSH processes share `DSH_HOME` (concurrent session store unverified); mobile has no team UI yet.

## Wave 6: real stack (✅ pushed `08d99ac`)

**End to end verified on 2026-10-19** with Colima (Docker 29.5.2, arm64), the real DSH 0.2.1-rc.2 in `brot-computer`, and OpenCode Go `deepseek-v4.1-flash`:
1. A `sandbox` bot answered `pong`; the relay counted 6,991 in / 49 out tokens (US$0.0011).
2. Asked to POST to httpbin.org, the run stopped at `waiting_approval` (`send · http_request`) with no `tool.result`; deny returned the user's reply to the model and nothing was sent.
3. Allow once: the server sent the POST and the bot read `json.hello = "brot"`.
4. All 109 computer tests pass against the real daemon (no skips).

Model relay (`apps/server/src/llm`): DSH in the computer talks only to `/llm/runs/<runId>/v1` through the egress sidecar with a per-run token; the server adds the vault key, pins the model, sends `x-opencode-session` (stable per thread and bot) and `User-Agent: brot/0.1.0` (OpenCode Go requirements), and reports usage as `cost.updated`. Provider keys never enter the computer. Bot models are `<provider>/<model>` (seeded: `opencode-go`, `deepseek`; more in `$BROT_HOME/providers.json`).

Fixes found only by the real run: Docker tmpfs is noexec by default and DSH's native addon loader dlopens from /tmp (now `exec` on /tmp only); ACP sessions used the host cwd inside the computer (now `/workspace`); OpenCode Go rejects requests without a session header.

Setup: `brew install colima && colima start --cpu 4 --memory 8`, `docker build -t brot-computer:latest images/computer`, `docker build -f images/computer/egress.Dockerfile -t brot-egress:latest apps/server/src/computers`, then `PUT /api/secrets/opencode-go`.

## Wave 7: computer use, an alive app, landing (2026-10-20, branch `feat/computer-use`)

Brot was picked over the sibling project guhbot by the use-case benchmark (docs/BENCHMARKS.md); guhbot is retired.

- **Bot desktops** (docs/COMPUTER-USE.md): `desktop: true` bots run `brot-desktop:latest` (Xvfb, openbox, Chromium behind the egress proxy). The server drives it only through `docker exec`: JPEG frames, xdotool input during a takeover, and `brot-browser` (Playwright over CDP) for accessibility snapshots with refs. Brot MCP adds `browser_*`, `computer_screenshot`, `request_takeover`. Read-risk tools no longer ask for approval unless a deny policy matches.
  **Verified on Colima:** a desktop bot created from the web UI started its computer, the live screen showed Chromium, Take control → click/type/Enter opened duckduckgo.com through the egress proxy, and control went back to the bot. No live model drove the tools yet (OpenCode Go monthly quota exhausted on 2026-10-20).
- **Web**: create/edit/archive/delete bots (role templates, animal avatar picker, provider-aware model picker, computer + egress + budget), Settings (provider keys, theme, devices, pairing with QR), approvals inbox, room members, live computer panel with takeover and pop-out, live avatar moods, tool timelines, skeletons, en/pt-BR/es.
- **Mobile**: live computer with takeover, rooms, @mentions, task board, haptics, en/pt-BR/es. Not run on a device.
- **Site**: OpenBot-style landing (style only; OpenBot is PolyForm Noncommercial) with a live product demo and a takeover demo.
- **Fixes from the benchmark**: delegated tasks close with their run; eval cases A1, A6, A8, A9, A14, B1, B5, B6 corrected; `CreateTask.chainId` so one run's delegations share a chain.

## Wave 8: MausBot parity starts with the browser (2026-10-22)

The reference product is installed on this machine; its docs, repo and the person's own workspace were
mapped in `docs/MAUSBOT-PARITY.md` (34 bots / 7 teams, 33 bots with a browser and 5 login profiles,
253 threads, 26 routines, 152 memory files).

- **Host browser.** `bot.browser: true` gives a bot a Chrome on the server machine with its own profile
  in `~/.brot/browser-profiles/<botId>`, driven over CDP with the same tool vocabulary as the desktop
  container (`browser_open/back/snapshot/click/type/key/scroll`). Browsing goes through the bot's `egress`
  policy via the existing HTTP CONNECT proxy; a headed login window is unproxied because the person drives
  it, and the profile keeps the session for later runs. Routes: `GET /api/bots/:id/browser`,
  `POST /api/bots/:id/browser/login`, `POST /api/bots/:id/browser/close`. Web: a Browser section in the
  bot dialog with the toggle, status, sign-in and close controls (en/pt-BR/es).
- **Desktop browser logins.** The container Chromium profile moved to `/workspace/.brot-browser` on the
  persistent workspace volume, so signed-in sites survive a container restart. Rebuilt and verified with
  the real daemon.
- **Tests:** 1316 pass (120 files), including real-Chrome integration tests (open + snapshot + field,
  egress and loopback refusal through the proxy, crash reaping) and real-Docker suites. A tsx-only bug was
  found live (`page.evaluate` serialised functions carrying esbuild's `__name`); snapshot/field page logic
  is now raw source evaluated as an expression, with regression tests.
- **Known gaps:** no live browser view/takeover for the host browser yet (desktop containers keep theirs);
  no saved-logins vault, no idle stop; the headed login window is unproxied by design. Deleting a bot now
  closes its Chrome and removes its profile. `request_takeover` wording still points desktop bots only.

## Wave 9: teams, many threads, routine runs (2026-10-22)

- **Teams.** A team is a named group with a shared brief and an optional Chief of Staff; bots carry
  `teamId`, and every member bot's prompt gets `Team: <name>` plus the brief. Routes: `GET/POST /api/teams`,
  `PATCH/DELETE /api/teams/:id`; deleting a team ungroups its bots. Web: collapsible team sections in the
  sidebar with counts and a pencil, a team dialog (brief, chief, roster, delete consequences) and a team
  select in the bot dialog. Migration 0006.
- **Many threads per bot.** The web client/state are thread-keyed: a bot row expands into its threads,
  `+ New thread` creates one, the thread header shows the title, and a send refreshes the list so the
  server auto-title appears. `PATCH /api/threads/:id` renames; the first user message of a default-titled
  thread names it. Rooms keep their flow.
- **Routine runs.** Every fire writes a durable run (schedule/webhook/manual) with status and result;
  a per-routine overlap guard writes `skipped`; completion comes from the bus (last assistant message);
  catch-up fires at most one missed occurrence within 12h; cron triggers take a timezone; `rememberLastRun`
  prepends the previous result. `GET /api/routines/:id/runs` and `GET /api/routine-runs` expose history.
  Migration 0007. The web routines surface comes with the next wave.
- Verified live: a team brief reached a DSH run ("ABACAXI" rule answered verbatim); two threads on one bot
  stayed isolated with auto-titles; a real every-minute cron fired, completed and captured its result.
  1411 tests pass (125 files), typecheck 12/12, lint clean.

## Wave 10: routines UI, skills and recall, bring-your-own MCP (2026-10-22)

- **Routines UI.** A Routines pane next to Tasks: human schedule line with timezone, last run and
  next run, enabled switch, Run now with the overlap 409 surfaced, inline run history (status, time,
  trigger, duration, result, error), edit and delete. The dialog builds a schedule from presets or a
  custom cron, with timezone, catchUp and rememberLastRun flags and the exact cron preview. i18n in
  en/pt-BR/es.
- **Skills and memory recall.** Skills were dormant: the prompt now has a Skills section (bot-specific
  first, 12 kB section cap, 4 kB per body, surrogate-safe truncation). Memories are ranked by lexical
  relevance with recency only as a tiebreak and capped at 12 / 6 kB (`apps/server/src/memory/recall.ts`).
  Verified live: a skill made a DSH run answer PITANGA; an older Tuesday-meetings memory reached the
  model among 15 memories.
- **Bring-your-own MCP servers.** Saved stdio/HTTP MCP servers attach to every run next to Brot's own,
  `secret://` env values resolve from the vault only into the child process, `/test` performs a real
  handshake and lists tools, and bare commands resolve against PATH to the absolute path ACP demands.
  Verified live: DSH called an external `echo` tool and answered with its result. Migration 0008.
- Suite: 1527 tests (135 files), typecheck 12/12, lint clean. Web surfaces for skills/memory and the MCP
  settings panel are the next wave.

## Wave 11: memory and skills UI, attachments (2026-10-22)

- **Memory and Skills tabs.** The bot context panel's Memory tab now lists the bot's memories with kind
  badges, dates, create/edit dialogs and delete with a confirmation; the Skills tab lists bot and shared
  skills with a "Shared" badge, a markdown editor that states the run-prompt budget, and a warning that
  editing a shared skill changes every bot. en/pt-BR/es.
- **Attachments backend.** Multipart upload (20 MiB, images + text/JSON + PDF/ZIP), bytes in
  `<BROT_HOME>/attachments/<id>` at 0600 with atomic writes, download with inline disposition and nosniff,
  delete refused for linked attachments, `attachmentIds` on messages with same-thread validation, and
  attachments returned by every message read. The run input gets an Attachments section: text/JSON inlined
  up to 8k per file and 24k total, images noted (no vision yet), no filesystem paths. A boot sweep removes
  files whose rows are gone, so deleting a bot or thread leaves no orphan bytes. Migration 0009.
  The composer/gallery UI comes next wave.
- Suite: 1600 tests (142 files), typecheck 12/12, lint clean. Verified live: an attached report's text
  reached a mock run input; the boot sweep removed the orphan left by deleting the test bot.

## Wave 12: attachments UI, notification records (2026-10-22)

- **Attachments in the UI.** Composer gets a paperclip and drag-and-drop, pending chips with name/size/
  remove, per-file errors and send-time uploads that clean up after a failed post; the transcript shows
  image thumbnails linking to the bytes and file chips with icon, name, size and open link, with a
  file-chip fallback when an image cannot load. Messages carry attachments through the live event and
  the history replay. en/pt-BR/es.
- **Notification records.** A service on the event bus records approvals (always), failures (always) and
  finished runs (only when the bot allows it and the answer has text), each with the thread to open and a
  300-character line; records prune after 30 days at boot. Bots have a per-bot `notifications` flag
  (absent = true). Routes: list (unread/bot/limit), unread count, mark read, delete. Migration 0010.
  The inbox UI and desktop notifications land next wave.
- Suite: 1653 tests (149 files), typecheck 12/12, lint clean. Verified live: attachment text in a run
  input; notifications for finished/failed runs, per-bot suppression and mark-all-read.

## Wave 13: notification inbox, usage ledger (2026-10-22)

- **Notification inbox (web).** Sidebar bell with an unread badge, a Notifications pane (newest first,
  bot avatar, kind badge, unread dot, relative time, mark all read, delete, click opens the thread), a
  20 s unread poll while visible and on focus, native desktop banners for newly seen unread records while
  the window is hidden (explicit enable in Settings, one banner per id, click opens the thread), and a
  per-bot notifications toggle in the bot dialog. en/pt-BR/es.
- **Usage ledger (server).** GET /api/usage aggregates runs (no new table): totals with
  completed/failed/cancelled counts, token and cost sums, bot filter, grouping by UTC day or bot, default
  last 30 days. GET /api/usage/export.csv streams RFC 4180 CSV with a UTF-8 BOM, CRLF, bot names and
  spreadsheet formula-injection neutralization. Live totals: 8 runs, 333,569 input / 3,291 output tokens,
  US$ 0.052. The Usage dashboard page lands next.
- Suite: 1709 tests (158 files), typecheck 12/12, lint clean.

## Wave 14: shared browser profiles (2026-10-22)

- **Login profiles shared by teams.** The unit of a running browser is now the effective profile: a bot's
  own profile or a shared one that several bots name. One Chrome, egress proxy and serial queue per
  profile, so a team signs into X/LinkedIn once and every member bot reuses the session; a login window
  opened by one bot reports `login` to the others. Different egress allowlists restart that profile's
  Chrome through the requesting bot's proxy (cookies survive); closing through any bot closes the
  profile; deleting a profile deletes its saved logins and ungroups its bots back to own profiles.
  Routes: `/api/browser/profiles` CRUD; bot browser status returns the resolved profile; bots accept
  `browserProfileId`. Web: Settings → Browser profiles (new/rename/bot counts/delete with consequences)
  and a profile picker in the bot dialog named in the status line. Migration 0011 also adds the
  `runs.started_at` index.
- Verified live: two bots on one profile shared login state, close through either stopped both, and
  deleting the profile ungrouped the bots and removed its directory.
- Suite: 1753 tests (161 files), typecheck 12/12, lint clean.

## Wave 15: team packages, MCP servers panel (2026-10-22)

- **Portable team packages.** A team (or the whole workspace) exports as one Markdown file with a JSON
  block: teams (brief + chief), bots (name, job, instructions, avatar, team), rooms (lead + members),
  cron routines and bot-scoped skills, keyed by local slugs so no ids or secrets leak; engine, model,
  computer, browser, egress, budgets, threads, runs and memories are never included, webhook routines
  are skipped and routines always arrive paused. Import validates the whole package first, creates fresh
  entities with defaults, remaps every reference and rolls back best-effort on failure. Routes:
  `GET /api/team-packages/export[?teamId=]` and `POST /api/team-packages/import`. Verified live with a
  full export → import round trip (1 team, 2 bots, 1 room, 1 paused routine, 1 bound skill).
- **MCP servers panel.** Settings lists saved stdio/HTTP MCP servers with transport badge, command/URL,
  enabled switch, a real handshake test (tool count + latency or error) and edit/delete; the dialog edits
  command + one-arg-per-line + env rows whose values may be `secret://` references, or a URL, with
  protocol validation inline. en/pt-BR/es. The sharing UI lands next wave.
- Suite: 1792 tests (167 files), typecheck 12/12, lint clean. Known flake: the desktop takeover timing
  test can fail under full-suite parallelism and passes in isolation (seen twice); worth a later fix.

## Wave 16: host browser live view, team packages UI (2026-10-22)

- **Host browser live view and takeover.** GET /api/bots/:id/browser/screen returns a 1280x800 JPEG
  frame of the live page (lazy launch, no-store). Takeover is one state per browser profile, shared by
  every bot on it: while the person holds it, bot browser commands are refused with a clear message and
  the frame keeps flowing; POST /api/bots/:id/browser/takeover shows/changes it and
  POST /api/bots/:id/browser/input accepts move/click/scroll/type/key (full device only, viewport
  validated). During the headed sign-in window the local window is the input surface and the API refuses
  input. Verified live: JPEG 1280x800, a real DSH run was refused three times during takeover, and after
  hand-back it opened example.com.
- **Team sharing UI.** Settings → Team packages: a scope select (whole workspace or one team) and a
  download named by the server headers; import from paste or a .md/.json file with a client-side preview
  (protocol parser) showing counts, names, the "no model/computer/browser/credentials" and "routines
  arrive paused" warnings, parser issues, a confirmation dialog and the created counts.
- Suite: 1839 tests (170 files), typecheck 12/12, lint clean.

## Wave 17: browser panel, today summary (2026-10-22)

- **Live browser panel (web).** The bot dialog's browser section opens a live view: JPEG frames poll
  every 1.5 s while open and visible, click/double-click/wheel map to the 1280x800 viewport, a
  Take control / Hand back toggle drives the per-profile takeover, and a controls row types text and
  presses Enter/Escape/Tab/Backspace. Input is only enabled while the person holds control; 409s
  (sign-in window, no browser) stop polling with an inline explanation and a retry.
- **Today summary (server).** GET /api/today returns run totals with terminal counts and token/cost
  sums, a per-bot breakdown sorted by cost, routine run counts by status, workspace-wide pending
  approvals and up to five highlights (last assistant message, 200 chars). The window defaults to local
  midnight in an IANA zone (Intl only, DST-safe) with explicit bounds accepted; the web page lands next.
- Suite: 1887 tests (177 files), typecheck 12/12, lint clean.

## Wave 18: insights page, per-bot approval mode (2026-10-22)

- **Insights page.** A top-level pane with Today (stat tiles, routine status line, per-bot table, clickable
  highlights, range control) and Usage (range/group-by selector, totals, localized table, CSV download of
  the same window). Numbers, currency and dates use Intl; skeletons, inline retry and empty states.
- **Per-bot approval mode.** Bots are `ask` (default) or `edits`. In edits mode a write tool call of kind
  shell/file_write/other runs without an approval, record or event and the run never leaves running; send,
  publish, delete, purchase and permission always ask in every mode, and deny policies always win.
  Migration 0012 adds bots.approval_mode. Verified live: an edits-mode DSH run pressed a key with zero
  approvals, and after switching to ask the same action paused for approval (deny completed the run).
- Suite: 1919 tests (181 files), typecheck 12/12, lint clean.

## Wave 19: approval mode UI, saved logins vault (2026-10-22)

- **Approval mode in the bot dialog.** An Approvals control offers Ask before risky actions (default) or
  Auto-approve edits, with the exact split spelled out and a safety note that irreversible actions always
  require a person and deny policies win. Create sends the mode only for edits; edit patches only on change.
- **Saved logins + fill_login.** Saved logins keep username/password/TOTP in the AES vault under per-login
  secret names; the API returns only id/name/host/label/hasTotp, and DELETE removes the vault values.
  `fill_login` is host-browser-only, validates that the page host matches the login, declares the
  credentials as secret references so the broker decides first, then types them as real keystrokes (with a
  dependency-free RFC 6238 TOTP) and submits; arguments, summary, output and errors are value-free, and the
  host is re-checked right before typing. Migration 0013 adds saved_logins. Verified live: an approval card
  appeared for a DSH run, allow produced a value-free failure on a page without a form, and zero credential
  bytes reached the event log; deleting the login removed its vault entries.
- Suite: 1959 tests (186 files), typecheck 12/12, lint clean.

## Wave 20: saved logins UI, message search (2026-10-22)

- **Saved logins UI.** Settings → Saved logins lists name, label, host, TOTP badge with edit/delete; the dialog
  creates a login or, on edit, prefills only metadata and leaves credentials blank ("Leave blank to keep the
  saved value"), sending only typed fields and offering to remove a stored TOTP secret. The copy states
  values are write-only and bots use fill_login only on the matching site; delete says the credentials are
  deleted and bots can no longer sign in.
- **Message search.** GET /api/search?q=&botId=&threadId=&limit=&before= does a parameterised LIKE across
  messages (wildcards escaped, filters, newest first, SQL limit) and returns hits with thread title, bot
  name, role, a 140-character snippet centred on the first match and the timestamp. Verified live: "pong"
  returned both Capy messages, a literal % matched nothing, bad limits were 400s. Known limits: LIKE scan
  (no FTS index yet), SQLite ASCII-only case folding, no archive filter.
- Suite: 1995 tests (192 files), typecheck 12/12, lint clean.

## Wave 21: thread model override, sidebar message search (2026-10-22)

- **Per-thread model override.** A DM thread can name its own `<provider>/<model>`; the run uses
  `thread.model ?? bot.model` for the relay route, the run row and the run.started label, and clearing it
  falls back. The route validates the ref format and known providers (400 issue path `model`), rooms refuse
  a thread model (a room has no single model), and null clears on any thread. Migration 0014 adds
  `threads.model`. Verified live: overriding a thread to deepseek made the run resolve that provider (and
  fail on its missing key), clearing returned to the bot's model and completed.
- **Sidebar message search.** Typing two or more characters runs a debounced global search and shows a
  Messages section with avatar, thread title/bot name, two-line snippet and relative time; up to 8 hits with
  an expander, loading/empty/inline-error states, Escape clears, and clicking a hit opens the room or the
  bot's thread. The bot/room filter keeps working independently.
- Suite: 2026 tests (197 files), typecheck 12/12, lint clean. Known flakes seen under full-suite load (both
  pass isolated and on rerun): desktop takeover timing, browser viewer screen route, and the tasks chain-max
  route. Gaps found: no API/UI to delete a room yet.
## Wave 22: thread model picker, room deletion (2026-10-22)

- **Thread model picker.** DM headers show the effective model (`thread.model ?? bot.model`, with a default
  hint) and open a picker listing the bot's model plus every provider model grouped by provider
  (unconfigured ones dimmed with the reason). Picking patches the thread and null restores the bot's model;
  the client's renameThread became `updateThread({title?, model?})` with protocol validation.
- **Room deletion.** DELETE /api/rooms/:id cancels running/waiting runs of the room, then deletes the
  thread so messages, runs, events, approvals, members, sessions and room-requested tasks cascade (tasks
  whose work thread pointed at it survive with the link cleared). 404 for unknown ids or DM threads, repeat
  delete 404s, no event. The room header gained an actions menu with Delete room behind the confirmation and
  selection falls back to the lead bot. Verified live: delete 204, repeat/DM 404, rename still works.
- Suite: 2051 tests (203 files), typecheck 12/12, lint clean. Follow-ups found: deleting a room leaves its
  attachment rows/files orphaned (the boot sweep only removes files with no row), stale in-memory room baton
  entries, and a narrow new-message-vs-delete race.
## Wave 23: SKILL.md import/export, desktop build fix (2026-10-22)

- **SKILL.md import/export.** Skills travel as Agent Skills markdown: GET /api/skills/:id/export returns
  frontmatter + body as an attachment `<slug>.SKILL.md`, and POST /api/skills/import accepts that document
  (or raw JSON) for one bot or shared, with a forgiving parser (optional frontmatter, CRLF, quotes, ignored
  keys, caps) and one clear issue per broken field. The Skills tab gains an export action per row and an
  import dialog with paste/file, a protocol-parser preview, this-bot vs shared target and confirmation.
  Verified live: export → delete → import round trip preserved name, description and body; invalid content
  400s.
- **Desktop production build fixed.** `pnpm build` failed because esbuild followed `playwright-core` (added
  for the host browser) into its optional `chromium-bidi` requires. `playwright-core` is now external in the
  desktop server bundle and a production dependency; web, site and desktop builds all pass (main.cjs ~2.2 MB).
- Suite: 2092 tests (210 files), typecheck 12/12, lint clean; full `pnpm build` green.
## Wave 24: voice (TTS) (2026-10-22)

- **TTS providers.** GET /api/voice returns the voice settings plus a cheap availability probe (never the
  key); PUT /api/voice saves them; POST /api/voice/speak returns audio bytes for 1-2000 characters with
  no-store. The system provider (macOS) runs `say` and converts to WAV with `afconvert`, falling back to
  AIFF; an OpenAI-compatible provider posts to /audio/speech with a vault key read at call time and returns
  MP3. Failures are plain 503 reasons with no key and no spoken text. Bots gain `speakReplies` (off by
  default). Migration 0015 adds a generic settings table and bots.speak_replies.
- **Voice UI.** Assistant messages get a speaker button (loading, stop/replace, inline errors, disabled with
  the reason when unavailable); bots with speakReplies speak new completed replies once (latest wins, with a
  stop control near the thread header); the bot dialog gains the toggle and Settings gains a Voice section
  (provider radio, voice, base URL/model/secret name, write-only key, availability reason, Test voice).
  en/pt-BR/es.
- Verified live: POST /api/voice/speak returned a 55 KB RIFF WAV rendered by the real `say` + `afconvert`.
- Suite: 2174 tests (221 files), typecheck 12/12, lint clean.
## Wave 25: workspace memory (About me) (2026-10-22)

- **Workspace facts.** Memory now has a scope ('bot' default or 'workspace') and an optional botId; GET/POST
  /api/profile/memories manage facts about the person, the shared PATCH/DELETE by id serve both scopes, and
  bot lists stay bot-only. Deleting a bot removes its memories but keeps workspace facts. Migration 0016 adds
  memories.scope and makes bot_id nullable (generated recreate fixed for old rows; upgrade test covers it).
- **Prompt.** Every run prepends up to 20 workspace facts (3000 chars, newest first) to the recalled bot
  memories, at most 32 items / 9000 chars combined, under an "About the person:" section before "Memories:";
  with no workspace facts the prompt is byte-identical to before.
- **UI.** Settings → About me lists the facts with kind badges, dates, edit and delete (the shared memory
  editor extracted from the bot Memory tab), with the exact delete consequence. en/pt-BR/es.
- Verified live: a workspace fact "the secret code is JABUTICABA" made a DSH run answer JABUTICABA while the
  bot's own memory list stayed empty.
- Suite: 2205 tests (226 files), typecheck 12/12, lint clean.
## Wave 26: per-bot MCP server grants (2026-10-22)

- **Grants.** A bot can pick which saved MCP servers it sees: `mcpServerIds` is an allowlist (absent/null =
  every enabled server, previous behaviour; [] = none; unknown/deleted ids ignored and pruned from the API
  on read). Brot's own MCP server always attaches. Migration 0017 adds bots.mcp_server_ids; POST/PATCH
  /api/bots validate named ids and return 400 listing unknown ones. The bot dialog gains an MCP servers
  fieldset (Every enabled server / Choose servers with checkboxes, disabled servers dimmed and excluded,
  Settings link when empty, note when none ticked), create/patch-only-when-changed. en/pt-BR/es.
- **Fix:** memory listing is now deterministic (rowid tie-break), removing a flaky workspace-caps harness test.
- Verified live: create with one grant, [] and two-id patches, deleting a granted server pruned it from the
  bot, unknown id 400.
- Suite: 2237 tests (229 files), typecheck 12/12, lint clean.
## Wave 27: model fallback chain (2026-10-22)

- **Fallbacks + recovery.** Bots carry up to three ordered fallback models. A relayed run resolves
  `[thread model ?? bot model, ...fallbacks]` and uses the first route that resolves (run row and a
  re-published run.started show the model actually used; all-unusable fails with the tried refs). If the
  engine fails before producing any assistant text and the run was not cancelled, the next fallback runs on
  the same run record with a fresh session/launch key; the same runId gets a second run.started, and
  run.failed is published once only after the last attempt. Partial text, cancellations, tool denials and
  non-relayed engines never retry. Migration 0018 adds bots.fallback_models; bot routes validate refs,
  providers, the 3-model cap and duplicates.
- **UI.** A Fallback models fieldset in the bot dialog (ordered list with remove, provider-grouped add
  select excluding the main model and duplicates, max 3, empty-state copy), create/patch-only-when-changed,
  en/pt-BR/es.
- Verified live: a bot whose primary deepseek model has no key emitted run.started for deepseek, then
  run.started again with opencode-go on the same runId and completed with "fallback ok".
- Suite: 2267 tests (232 files), typecheck 12/12, lint clean.
## Wave 28: per-bot budget caps (2026-10-22)

- **Caps.** Bots can cap spending per run and per UTC day. The daily cap is checked once at run start
  before the engine or computer (sum of the bot's runs since UTC midnight, one query) and fails the run
  instantly with a plain message; the run cap is checked after every usage report and aborts the active run
  when cost crosses it, marking it failed with the exact spent/limit message, keeping partial text, never
  cancelled and never falling back to another model. Caps are independent, 0 blocks spending, and uncapped
  bots behave exactly as before. Migration 0019 adds bots.run_budget_usd and bots.daily_budget_usd; bot
  routes validate both. The bot dialog gains a Budgets fieldset (two $ inputs with inline validation for
  negatives/decimals/non-numbers, parsed-amount hint, create/patch-only-when-changed, null on clear).
- Verified live: a $0 daily cap failed with zero tokens; a $0 run cap aborted after the first usage report
  with the exact message.
- Suite: 2293 tests (235 files), typecheck 12/12, lint clean.
## Wave 29: bot presets (2026-10-22)

- **Presets.** A preset carries a name, job, instructions and the avatar look. GET/POST /api/presets,
  PATCH/DELETE /api/presets/:id, and POST /api/presets/from-bot/:botId copying an existing bot under an
  optional new name (oversized values clipped, non-conforming avatars dropped). Duplicate names allowed.
  Migration 0020 adds bot_presets.
- **UI.** Create dialog: a Start from a preset strip with avatar/name/job cards that applies the draft.
  Edit dialog: Save as preset with an editable name and inline confirmation. Settings: a Bot presets section
  to create/edit (name, job, instructions, look) and delete (consequence: existing bots are not affected);
  shared avatar label maps extracted. en/pt-BR/es.
- Verified live: create, from-bot copy of Teste's values, name-ordered list, rename, invalid avatar 400 and
  deletes.
- Suite: 2329 tests (239 files), typecheck 12/12, lint clean.
## Wave 30: approval decision log (2026-10-22)

- **Decision log.** GET /api/decisions lists resolved approvals (allowed/denied) newest first with a
  half-open decidedAt range, bot/decision filters and a limit; only audit fields are returned, never tool
  arguments. GET /api/decisions/export.csv streams the same rows as RFC 4180 CSV with a UTF-8 BOM, CRLF,
  formula-injection neutralization and an attachment filename. Defaults to the last 30 days; bad inputs are
  400s. No new table or migration.
- **Activity section.** Settings shows the audit trail with decision badges, bot avatar/name, tool, summary,
  relative time and replies; filters for decision and range, Refresh and CSV download; loading/empty/error
  states. en/pt-BR/es.
- Verified live: a browser_key approval denied with a reply appeared in the log and the deny filter, the CSV
  had the BOM and expected header, and an invalid decision was a 400.
- Suite: 2365 tests (244 files), typecheck 12/12, lint clean.
## Wave 31: desktop app smoke, onboarding (2026-10-22)

- **Desktop app verified.** Rebuilt the web bundle and the desktop main bundle, then launched the real
  Electron app with an isolated `BROT_HOME` and `BROT_DESKTOP_PORT=8898`: the gateway served the Brot UI
  (`<title>Brot</title>`), the embedded server answered `/api/health`, `/api/bots` (seeded Capy) and
  `/api/providers`, and a fresh home applied all 21 migrations. Closed and cleaned up afterwards.
  Caveat found: an environment that exports `ELECTRON_RUN_AS_NODE=1` makes `electron .` run as Node and the
  app crashes at startup with `Cannot read properties of undefined (reading 'getPath')` — unset that
  variable when launching. This was verified to be the only cause; without it the app starts normally.
- **Getting started onboarding.** A calm dialog auto-opens for a fresh workspace (no conversations/rooms and
  not dismissed) and reopens from a sidebar action: five checklist rows (model key, say hello, browser or
  computer optional, schedule a routine, pair a phone optional) with done/pending states, actions into the
  existing flows, skeleton + retry for the cheap checks, and remind-later vs persisted don't-show-again.
  en/pt-BR/es.
- Suite: 2379 tests (246 files), typecheck 12/12, lint clean; full `pnpm build` green.
- Known flakes (seen under full-suite load, always green isolated/rerun): desktop takeover timing, browser
  viewer screen capture, tasks chain-max route.
## Wave 32: pairing code validation and rate limiting (2026-10-22)

- **The pairing code is now verified.** PairingComplete requires the six-digit code (400 when missing or
  malformed); the pending token keeps its code and completion compares it in constant time. A wrong code
  and an unknown/expired token produce the same 401, the token is consumed on every attempt, and only a
  successful pairing creates a device. The QR payload carries the code ({v,host,port,token,code}).
- **Attempt rate limiting.** Five failures in a rolling minute lock the normalized caller address for ten
  minutes (429 with the remaining minutes); a locked caller cannot burn tokens, success clears the counter,
  the map is bounded and pruned without timers.
- **Clients.** The mobile payload schema requires the scanned code; the confirm step shows it read-only from
  a QR or asks for it in a numeric six-digit field when a raw token is pasted; the session sends it. Settings
  keeps the code prominent with a Copy code action and copy explaining manual entry needs it. en/pt-BR/es.
- Verified live: wrong code 401 and token consumed, missing code 400, correct code issued a device token,
  five failures then the correct code got the 429 lock message; device cleaned up.
- Suite: 2390 tests (246 files), typecheck 12/12, lint clean (fixed a shadowing warning in the mobile pair
  screen during integration).
## Next

1. Re-run the eval suite on a live model once OpenCode Go has quota (`apps/evals`, `--base` to the server), including B8 and C; the 2026-10-20 results predate the read auto-allow and the fixes above.
2. A live run of a desktop bot doing a web task end to end (snapshot → click → takeover on sign-in).
3. Signed desktop builds and a first GitHub release; the site's download links point to releases.
4. SSE id cursor; persist the baton and takeover state; a per (thread, bot) relay URL.

## Decision: DeepSeek Harness is the only runtime (2026-10-19)

The user chose DSH (`@deepseek-ai/dsh`, MIT) as the single agent runtime, driven over ACP. Providers are configured inside DSH (DeepSeek, Anthropic API, OpenAI, OpenRouter, local, and DSH's native sign-ins such as ChatGPT/Codex OAuth). Brot must not route Claude Free/Pro/Max OAuth outside Claude Code: Anthropic's terms forbid it. DSH is a developer preview, so pin its version and keep it behind `EngineDriver`.

## Backlog

- Server gaps: `GET /api/threads/:id/events` for exact history; SSE `Last-Event-ID` replay; make `trustLoopback` configurable (a same-host reverse proxy currently skips auth); first-device pairing through Docker's published port; `run.cancelled` event; webhook HMAC; `runs.listByStatus`.
- Relay: the server must mint channel ids with ≥128 bits of randomness; server-side relay client not built. CLI needs a `--token` flag for remote servers.
- Docker: digest-pin `node:24-slim`, drop devDependencies from the runtime image, run `docker build` once the daemon is up.
- `useChat`: buffer live events until `history-loaded` so early deltas aren't lost.
- Mobile: real push notifications, live computer view, typed routes; pairing by 6-digit code needs server support. Stop/Unpair use neutral styling (DESIGN.md says danger for Stop): revisit.
- Site: waitlist has no backend; Download points to GitHub Releases (empty until the first desktop release).

## Known decisions and gaps

- **Protocol vs. ARCHITECTURE.md**: the event union has no `computer.frame` or `handoff` yet. `EngineDriver` uses a single `run(ctx)` with `ctx.requestTool()` instead of `start/respond/cancel`. Add those events when computers and rooms are built.
- **Engines**: `run()` throws on failure, and the harness turns that into `run.failed`. `registry.register()` throws on a duplicate id.
- **Server decisions**: no `run.cancelled` event yet (cancel publishes `run.failed`). The JSON content-type and loopback `Host` guards block CSRF and DNS rebinding. Pairing `host` defaults to 127.0.0.1 (set `BROT_HOST` to the LAN IP for phones), and the 6-digit code isn't checked. No webhook HMAC yet. `packages/db` needs `runs.listByStatus`.
- **Design**: light `--ink-3` is `#6F6F6F` (not `#737373`) so placeholders on `--surface-2` pass AA. Safari animates the eye-path morph instantly instead of tweening.
- **Environment**: Docker is installed but the daemon wasn't running, so the sandbox image (`images/computer`) hasn't been built or tested.
- **Out of scope for v1**: Brot Cloud (Firecracker, Stripe), computers/sandboxes, Composio, REA, social publishing. See `docs/ROADMAP.md`.

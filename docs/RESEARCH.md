# Research: Grok Bot, MausBot, REA

> Snapshot taken **2026-10-19**. Third-party numbers (stars, prices) change quickly, so recheck them before quoting.

## 1. Grok Bot (xAI). The product we're cloning

**What it is.** A beta product (launched **2026-08-11**) for long-running AI agents called *Bots*. Each Bot has a role and works on a **cloud computer** (browser, files, CLI), so work continues after the user closes their laptop. It grew out of Grok Automations (July 2026) and the parallel workflows in Grok Build.

**Feature set**

| Area | What Grok Bot does |
|---|---|
| Bot creation | Pick a suggested role or define your own: name, one main job, and how the Bot should work. xAI recommends narrow Bots. |
| Cloud computer | Browser, files, and terminal. **One computer per account**, shared by all Bots. Each Bot gets its own screen. |
| Computer takeover | The human takes over for passwords, 2FA, and CAPTCHAs. |
| Connectors | Gmail, Calendar, Drive, OneDrive, Outlook, Teams, SharePoint, and Salesforce, plus a plugin marketplace (Composio) and custom MCP servers (must be publicly reachable). |
| Multi-agent | Group chats of 2–6 Bots. Bots message each other and hand off ownership of work. |
| Memory | Per-Bot role, preferences, and summaries of past work. |
| Skills | A process that worked can be saved as a reusable skill. **Teach-by-demonstration**: you record a browser workflow once and it drafts a skill. |
| Routines | Schedules and event triggers. |
| Approvals | Gates for sending, publishing, deleting, purchasing, and permission or production changes. Includes Auto Review. |
| Platforms | macOS, Windows, and an iPhone companion app. **No Linux, Android, or iPad** at launch. |
| Access | Bundled with SuperGrok Heavy, Cursor Ultra, and Cursor Teams Premium. Reported prices range from about $120/seat to $200/month. |

**Weaknesses we can exploit (our opportunity)**
1. **No self-hosting.** The computer is managed by xAI.
2. **All Bots share one computer and its credentials.** xAI says Bots are not separate security boundaries.
3. **Memory is opaque.** You can't inspect, edit, export, or delete individual memories.
4. **Locked to Grok/Cursor models.**
5. No Linux, Android, or iPad support.
6. Weekly usage limits stall swarms mid-task.
7. Custom MCP servers have to be public.
8. No published success rate. The orchestration is closed.

Sources: [unite.ai](https://www.unite.ai/xai-launches-grok-bot-always-on-ai-teammates-with-their-own-cloud-computers/), [Composio guide](https://composio.dev/content/guide-to-frok-bot), [Vellum breakdown](https://www.vellum.ai/blog/official-grok-bot-breakdown), [agent-finder review](https://agent-finder.co/reviews/grok-bot), [beam.ai](https://beam.ai/agentic-insights/grok-bot-enterprise-ai-agents), [digitalapplied](https://www.digitalapplied.com/blog/grok-bot-ai-teammates-launch-cloud-computer-2026).

## 2. MausBot / OpenMausBot. The business model we're copying

**What it is.** A local-first, open-source desktop chat app (Apache-2.0, formerly *OpenGrokBot*) where each contact is a bot. Repo: [milind-soni/OpenMausBot](https://github.com/milind-soni/OpenMausBot) (about 2–2.5k stars). Site: [mausbot.com](https://mausbot.com/).

**Business model**
- The app is free and open source. Model usage is BYO: the user's own CLI login or API key.
- Paid, optional **Cloud plans** (always-on, cloud desktops, higher event limits). Every plan has a 3-day trial with $5 in Claude credit, and a card is required.
- Enterprise tier. `enterprise/` is a source-available folder that can be deleted.
- "MausBox" hardware concept (waitlist).
- A Discord community of about 2.8k is the main channel, including mobile beta builds.

**Architecture (worth learning from)**
- Two processes: a React 19 + Vite + Tailwind UI inside **Electron**, and a **harness server** at `127.0.0.1:8799`.
- The UI sends typed HTTP commands and folds **one SSE event stream** into state.
- The harness owns the agent processes and normalizes each provider's protocol into a **canonical event stream**, logged per thread as **NDJSON**.
- Driver registry (`server/drivers/`): adding a provider takes one file plus a one-line registration. Custom engines plug in via **ACP** or an OpenAI-compatible endpoint.
- A permission broker turns risky actions into **inline approval cards**.
- A separate webhook receiver listens on `:8800`.
- Composio for apps (500+), with events delivered by long-polling, so no public IP is needed. Gmail is polled every 15 minutes.
- **Cua Driver** for local computer use. **boat.dev** for cloud Linux desktops (paid).
- Voice: ElevenLabs, Fish Audio, xAI, and local Chatterbox.
- Headless CLI (`team apply`, `run`, `--json`), plus a bounded stdio MCP server that excludes approvals, deletion, credentials, and computer lifecycle.
- Teams installable from Markdown, presets, and an org library.
- Persistence is all files (`~/.openmausbot`). **API keys sit in plaintext `config.json` (0600).** That's a weakness.

**Weaknesses we can exploit**
- Bots stop when the host machine sleeps. The cloud and mobile features are still "in development."
- Plaintext secrets. No database, so no multi-user or team server.
- Cloud desktops come from a third party (boat.dev), so margins and control belong to someone else.
- No published pricing, which builds less trust.

Sources: [mausbot.com](https://mausbot.com/), [OpenMausBot README](https://github.com/milind-soni/OpenMausBot), [scriptbyai](https://www.scriptbyai.com/openmausbot-grok-bot-alternative/), [osrepos](https://osrepos.com/repo/milind-soni-openmausbot), [Julian Goldie review](https://aisuccesslabjuliangoldie.com/blog/openmausbot/), [AlternativeTo](https://alternativeto.net/software/openmausbot/about/).

## 3. REA (Reverse Engineer Anything). Our differentiator

**What it is.** [morluto/rea](https://github.com/morluto/rea) is an MIT-licensed **MCP server + CLI** that lets agents reverse engineer software and return **findings with evidence and stated limitations**. Website: rea.tools.

- Install: `npx rea-agents setup`, or globally with `npm i -g rea-agents` (`rea --help`, `rea update`).
- Headless example: `npx -y rea-agents@latest analyze-javascript-application /abs/path --json`.
- Requires Node 22.19+, 24.11+, or 26+.
- **Targets**: native binaries (pseudocode, asm, strings, symbols, xrefs), ELF, Go/Rust metadata, WASM, EVM bytecode, **JS/Electron apps** (modules, IPC, routes), **websites**, **HAR/SAZ/mitmdump captures**, .NET, **Android APK/adb**, Flutter, SQLite, firmware, pcap, logic-analyzer traces, Apple bundles, Linux crashes, and process behavior.
- Native analysis uses *providers*: Ghidra (free), Hopper, or IDA (user-licensed). **Static JS and .NET need no provider.**
- Runs locally. Static analysis reads files without executing them.
- Showcases: DX-Ball (3,205 tests reproduced byte-exact), Notion (clipboard traced through preload and IPC), TH04 (16-bit DOS).
- Responsible-use clause: lawful research, interoperability, preservation, and software you own or are authorized to analyze.

**Why it matters for us.** No competitor has "point a bot at an app and get an evidence-backed teardown, then hand it to an engineer bot to rebuild." That combines Grok Bot's *Competitor Watch* and *Bug Fixer* roles with a real analysis engine. See [REA-INTEGRATION.md](./REA-INTEGRATION.md).

## 4. Positioning summary

| | Grok Bot | MausBot | **Brot** |
|---|---|---|---|
| Open source | ✗ | ✓ Apache-2.0 | ✓ AGPL-3.0 core (see BUSINESS.md) |
| Self-host | ✗ | ✓ desktop | ✓ desktop, **Docker server**, Helm |
| Always-on hosted | ✓ | in development | ✓ Brot Cloud |
| Isolation per bot | ✗ shared computer | partial | ✓ **one sandbox per bot** (default) |
| Inspectable memory | ✗ | files | ✓ **editable memory UI** |
| Models | Grok/Cursor | Claude/Codex/Grok/ACP | Any (CLI, SDK, ACP, OpenAI-compatible, local) |
| Reverse engineering | ✗ | ✗ | ✓ **REA built in** |
| Linux / Android | ✗ | Linux beta | ✓ |
| Secrets | managed | plaintext file | OS keychain / sealed vault |
| Multi-user server | ✓ | ✗ | ✓ |

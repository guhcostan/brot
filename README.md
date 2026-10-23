<div align="center">

# brot

**Your own team of AI bots, baked fresh. Self-host it, or let us keep the oven on.**

Every bot has a job, a model, its own computer, and your apps. Talk to them like contacts, watch them work, approve what matters, from your desktop or your phone.

`open source · AGPL-3.0 · TypeScript · any model`

</div>

---

## Why Brot

| | |
|---|---|
| 🍞 **Yours** | Desktop app, `docker compose up`, or Brot Cloud. Same code everywhere |
| 🧱 **One bot, one sandbox** | Every bot gets its own isolated computer by default |
| 🖥️ **Watch it work, take the wheel** | Give a bot a desktop: see its screen live, take control for a sign-in or a CAPTCHA, hand it back ([computer use](docs/COMPUTER-USE.md)) |
| 🔍 **Glass-box memory** | See, edit, delete, and export everything a bot remembers |
| 🧠 **Any brain** | One runtime, the DeepSeek Harness, with any provider: DeepSeek, Anthropic, OpenAI, OpenRouter, local models |
| ✋ **You hold the keys** | Payments, posts, and deletions wait for your approval. Secrets never reach the model |
| 📱 **Pair your phone** | Scan a QR code and control bots on your laptop or in the cloud |
| 🔬 **Teardowns** | *Planned:* [REA](https://github.com/morluto/rea) teardowns — point a bot at an app and get an evidence-backed explanation of how it works ([spec](docs/REA-INTEGRATION.md)) |

## Quick start

```bash
# requires Node 24+ and pnpm 10+
pnpm install
pnpm dev            # server on 127.0.0.1:8799, web UI on http://localhost:5199
```

CLI:

```bash
pnpm brot doctor    # which engines are installed and logged in
pnpm brot serve     # run the server headless
pnpm brot backup    # snapshot the database, attachments and settings
pnpm brot restore --from <dir>   # restore into a stopped server's home
```

Bot computers run in Docker (on macOS, [Colima](https://github.com/abiosoft/colima) works well). Build the images once:

```bash
docker build -t brot-computer:latest images/computer
docker build -f images/computer/egress.Dockerfile -t brot-egress:latest apps/server/src/computers
docker build -t brot-desktop:latest images/desktop   # for bots with a desktop
```

Then add a model key in **Settings → Model providers** (OpenCode Go and DeepSeek are built in).

Self-host with Docker:

```bash
docker compose -f deploy/compose.yaml up -d
```

Back up and restore a self-hosted home with [docs/BACKUP.md](docs/BACKUP.md) (stop the server before restoring).

## How it works

```
 Web · Desktop · Phone · CLI
          │ HTTP + SSE
     Brot server ── DeepSeek Harness (ACP) ── any provider
          │          permission broker → approvals
          │          scheduler → routines
          └── one sandboxed computer per bot
```

Read more: [Architecture](docs/ARCHITECTURE.md) · [Backup & restore](docs/BACKUP.md) · [Product spec](docs/PRODUCT.md) · [Design](DESIGN.md) · [Tech stack](docs/TECH-STACK.md) · [Web actions](docs/BROWSER-AGENT.md) · [Remote control](docs/REMOTE-CONTROL.md) · [REA](docs/REA-INTEGRATION.md) · [Roadmap](docs/ROADMAP.md) · [Business](docs/BUSINESS.md) · [Research](docs/RESEARCH.md)

## Responsible use

Brot acts only on your own accounts, on tasks you ask for. It doesn't circumvent site protections: when a site asks for a CAPTCHA or sign-in, the bot hands that step to you. See [SECURITY.md](SECURITY.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md).

## License

Core: AGPL-3.0. Protocol, SDK, and community teams: Apache-2.0. `cloud/`: source-available. See [docs/BUSINESS.md](docs/BUSINESS.md#licensing-open-core).

Brot is an independent project, not affiliated with xAI, Anthropic, OpenAI, or the MausBot project.

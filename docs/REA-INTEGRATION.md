# REA Integration: Teardowns

[REA — Reverse Engineer Anything](https://github.com/morluto/rea) (MIT) is an MCP server + CLI that lets agents analyze software and return **findings with evidence and stated limitations**. Brot ships it as a first-class tool so a bot can study how a feature works and hand that understanding to an engineer bot to rebuild it.

> **Responsible use.** REA is for lawful work: interoperability, education, software preservation, security research, and analysis of software the user owns or is authorized to examine. Brot surfaces REA's own responsible-use notice and requires the user to acknowledge authorization before a teardown runs (feature H6 in [`PRODUCT.md`](./PRODUCT.md)). Teardowns are not used to defeat protections or site access controls.

## How it's wired

1. **Bundled in `brot-computer`.** The sandbox image installs `rea-agents` globally and configures providers: **Ghidra** (free) ships in the cloud image for native analysis; Hopper/IDA are bring-your-own-license (P2). Static JavaScript/.NET analysis needs no provider.
2. **Exposed as MCP.** `packages/tools/rea` registers REA's MCP server in the bot's tool hub, so any bot can call it. Static analysis reads files without executing them.
3. **Run surface.** A bot runs REA either through MCP (interactive) or the headless CLI for batch jobs, e.g.:
   ```
   npx -y rea-agents@latest analyze-javascript-application /work/app --json
   ```
4. **Results become Teardown objects.** Brot parses REA's findings into a structured `Teardown` with evidence cards, so the UI can render them and a second bot can consume them.

## Product surfaces

- **Product Detective** role (H2): a prebuilt bot whose job is "analyze how a feature works and report with evidence." Lives in `teams/product-detective.md`.
- **`/teardown <target>`** (H3): point it at a web bundle, a file, or an app the user is authorized to analyze. Output: findings, evidence, and limitations, each linked to its source.
- **Build-this handoff** (H4): a teardown hands off to an engineer bot (Bug Fixer / coding bot) that proposes an implementation and opens a PR in the user's own repo. Evidence travels with the handoff.
- **Competitor Watch** (H5): a routine re-runs a teardown of a competitor's **public** web bundle on a schedule and reports a **diff** ("they shipped X since last week"). Only publicly served assets, only for products the user is authorized to study.

## Why this is our moat

No competitor combines a chat-first bot team with an evidence-backed reverse-engineering engine. "Point a bot at a feature you admire → get a sourced explanation → hand it to an engineer bot to build your own version" is a workflow Grok Bot and MausBot cannot do today. See the comparison table in [`RESEARCH.md`](./RESEARCH.md).

# Security Policy

## Reporting a vulnerability

Please don't open a public issue. Use GitHub's private vulnerability reporting on this repository. We acknowledge reports within 3 business days and aim to fix critical issues within 14 days.

## Security model (as built today)

This is what the code in this repository actually enforces. Planned controls are listed separately, so
nobody relies on a control that does not exist yet.

- **Local by default.** The server binds `127.0.0.1`. Loopback callers are trusted; the web UI reaches the
  server through the dev proxy, which keeps the `Host` header on loopback. Other callers need a device
  bearer token (`Authorization: Bearer …`), stored as a SHA-256 hash and revocable in Settings.
- **Host and content-type guards.** A trusted-address request must name a loopback `Host` (defeats DNS
  rebinding), and state-changing requests must send `Content-Type: application/json` (defeats simple
  cross-site form posts).
- **Per-bot isolation.** A `sandbox` bot's shell and files run in its own Docker container. Its only way
  out is an egress sidecar proxy with a per-bot allowlist and DNS-rebinding checks; the Brot endpoint is
  the single exempt host. A `host` bot has no isolation: it drives the person's machine and requires
  `BROT_MODE=desktop` plus explicit opt-in.
- **Secrets.** An AES-256-GCM vault (`~/.brot/vault.key`, 0600, one key per name) holds provider keys and
  other secrets. Bots get `secret://` references; the relay adds real provider keys to outbound model
  requests, so keys never enter the model context or a bot's computer. Tool calls resolve secrets only
  after the broker allows them.
- **Approvals.** The broker decides allow / deny / ask per tool call against per-bot policies. Risky calls
  pause the run until a human answers; `allow always` writes a policy row.
- **Webhooks.** A separate listener on its own port with only `POST /h/:secret`; the secret is an
  unguessable path. There is no HMAC yet (see below).
- **Pairing.** A single-use, two-minute token plus a 6-digit code shown as a QR payload; the token is
  exchanged for a per-device bearer token. The 6-digit code is not verified server-side yet. The relay is
  a blind WebSocket forwarder (it does not inspect frames), but the app does not yet add end-to-end
  encryption on top of it.
- **Containment limits, stated plainly.** Browser automation on the server machine runs Chrome as the
  person's OS user, constrained by the bot's egress allowlist through an HTTP CONNECT proxy, not by a
  network namespace. The headed sign-in window is deliberately unproxied while the person drives it.

## Not built yet (do not rely on)

- OS keychain storage, HMAC webhooks, HMAC-signed relay frames or E2E relay encryption, a `computerd`
  daemon, per-bot capability tokens for tool calls, supply-chain controls (digest pinning of the base
  image, SBOMs, signed releases), per-device scopes on the REST API, and the REA teardown tool (planned;
  see `docs/REA-INTEGRATION.md`).

## Acceptable use

Brot automates your own accounts on your own instructions. It does not include, and will not accept
contributions that add, functionality to circumvent CAPTCHAs, bot detection, fingerprinting, rate limits,
or other access controls, or to operate multiple or fake identities.

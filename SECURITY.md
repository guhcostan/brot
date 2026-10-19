# Security Policy

## Reporting a vulnerability

Please don't open a public issue. Use GitHub's private vulnerability reporting on this repository. We acknowledge reports within 3 business days and aim to fix critical issues within 14 days.

## Security model

- **Local by default.** In desktop mode the server binds to `127.0.0.1`. Remote access requires authentication and device pairing.
- **Per-bot isolation.** Each bot runs in its own sandboxed computer. Computers can't reach the server's database or vault. They talk to the server only through `computerd`, with a per-computer token.
- **Secrets.** Stored in the OS keychain (desktop) or libsodium-sealed (server). Bots get short-lived `secret://` references, and values never enter model context.
- **Approvals.** Payments, purchases, posts, sends, deletions, and permission changes pause in the permission broker until a human approves.
- **Webhooks.** Separate listener, unguessable secret paths, HMAC verification.
- **Pairing.** Noise XX handshake with an emoji safety check, per-device keys, and revocation. The relay only sees ciphertext.
- **Supply chain.** Images pinned by digest, SBOMs, signed releases.

## Acceptable use

Brot automates your own accounts on your own instructions. It does not include, and will not accept contributions that add, functionality to circumvent CAPTCHAs, bot detection, fingerprinting, rate limits, or other access controls, or to operate multiple or fake identities. Reverse-engineering features (REA) are for software you own or are authorized to analyze.

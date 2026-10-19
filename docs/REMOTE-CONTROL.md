# Remote Control: pair your phone with your bots

**Goal.** Control bots from a phone, whether they run on your computer (desktop / self-host) or on Brot Cloud. That covers chatting, approving actions, watching the live computer, taking over, and getting push notifications.

## Topology

```
 ┌──────────── Phone (Expo app) ────────────┐
 │ inbox · chat · approvals · live screen   │
 └───────┬───────────────────────▲──────────┘
         │ E2E-encrypted channel │ push (APNs/FCM via relay)
 ┌───────▼───────────────────────┴──────────┐
 │ Brot Relay (relay.brot.dev, or self-host) │  ← blind forwarder, never sees plaintext
 └───────▲───────────────────────▲──────────┘
         │ outbound WebSocket    │ outbound WebSocket
 ┌───────┴────────┐      ┌───────┴──────────┐
 │ Desktop server │      │ Brot Cloud ws    │
 │ (your laptop)  │      │ (native, no relay needed) │
 └────────────────┘      └──────────────────┘
```

- **Cloud workspaces**: the phone talks to the cloud API directly (normal auth). Pairing simply links the device.
- **Desktop / self-host**: the server opens an **outbound** connection to the relay, so no port forwarding and no public IP are needed. The relay forwards opaque frames.
- **Direct paths** when available: same LAN (mDNS discovery), Tailscale, or the user's own reverse proxy. The relay is the fallback.

## Pairing flow
1. Desktop: **Settings → Devices → Pair phone** shows a QR code plus a 6-word code. The QR contains `{serverId, relayUrl, ephemeralPubKey, pairingToken(ttl=120s)}`.
2. The phone scans it, and the two sides run a **Noise XX / X25519** handshake over the relay. Both screens show a **4-emoji safety check**.
3. The user confirms on desktop. The server stores a device record `{deviceId, pubKey, name, role, lastSeen}`.
4. Each device then holds a long-lived keypair. Sessions rotate keys. Lost phone: **Revoke** in Settings.
5. Per-device roles: `full` (chat + approvals + takeover) or `approver` (approvals only) or `viewer`.

## What the phone can do
| Feature | P |
|---|---|
| Bot list, threads, streaming chat | P0 |
| **Approval cards** with push notification (Allow / Deny / Reply). Sensitive actions require Face ID / biometric on the phone | P0 |
| Start, pause, or stop a run; trigger a routine now | P0 |
| Live computer view (low-fps JPEG stream → WebRTC later) | P0 |
| **Take over** from the phone (tap/type on the bot's computer) for logins, 2FA, and CAPTCHAs | P1 |
| Share sheet: send a link, photo, or video to a bot ("post this", "analyze this") | P1 |
| Voice message to a bot | P1 |
| Multiple servers (home laptop + cloud workspace) in one app | P1 |
| Home-screen widgets (pending approvals, running bots) | P2 |

## Push notifications
- Push goes via the relay (Expo Push → APNs/FCM). The payload is **encrypted** and contains only `{serverId, eventId}`. The app fetches and decrypts the content itself.
- Notifications fire on: approval requested, run failed, routine finished (opt-in), and a bot mentioning you.

## Availability caveat (desktop)
If bots run on the laptop and it sleeps, they stop. The app shows the host as **"Oven off · last seen 14:02"**, and offers:
- macOS/Windows: "Keep awake while bots are running" (power assertion).
- **Move this bot to Cloud**: migrates bot config, skills, and memory to a Brot Cloud computer. This is the main upsell path.

## Implementation notes
- `apps/mobile`: Expo + Expo Router, shares `packages/protocol` (events) and `packages/ui` tokens (RN port).
- Relay: small Go or Node service (`apps/relay`), stateless, horizontally scalable. Self-hostable with one binary.
- Crypto: `libsodium` (react-native-libsodium on device). No custom crypto.
- Offline: the phone caches the last N events per thread. Approvals are queued and idempotent (`approvalId`).

# Computer use: bot desktops

A bot with `computer: 'sandbox'` and `desktop: true` gets a computer with a screen: a Linux desktop
(Xvfb, a light window manager and Chromium) in its own container. The bot drives the browser through
Brot MCP tools. The person watches the screen live from the web, desktop and phone apps, and can take
control at any moment, for example to sign in, solve a CAPTCHA or enter a 2FA code. Then they hand
control back.

The bot's model may be text-only (the default model, `opencode-go/deepseek-v4.1-flash`, has no
vision), so the main way a bot sees a page is a **text snapshot of the accessibility tree** with
numbered refs. A screenshot tool exists for vision models.

## Security model (unchanged from headless sandboxes)

- No new network surface. The server reaches the desktop **only through `docker exec`**: screenshots,
  input and browser control all run as commands inside the container. No VNC port is published.
- Chromium runs with `--proxy-server=http://brot-egress:3128`, so the bot's egress allowlist applies
  to the browser exactly as it applies to the shell. Blocked hosts produce `network.blocked`.
- No secrets in the container. The bot fills a password field only through the human takeover.
- Guardrail: the bot never bypasses a CAPTCHA, a bot check or a sign-in challenge. It calls
  `request_takeover` and waits.

## Image: `brot-desktop:latest` (`images/desktop/`)

`FROM brot-computer:latest` plus: `xvfb`, `openbox` (or `fluxbox`), `chromium`, `xdotool`,
`imagemagick` (`import` for screenshots), `fonts-noto` and `fonts-noto-color-emoji`, `dbus-x11`.
`playwright-core` is installed globally, pinned. `DISPLAY=:1`, and the screen is
`DESKTOP_WIDTH`x`DESKTOP_HEIGHT` (1280x800) from `@brot/protocol`.

`/usr/local/bin/brot-desktop-start` starts Xvfb, the window manager and Chromium. Chromium runs with
`--remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 --proxy-server=… --no-first-run
--user-data-dir=/workspace/.brot-browser`, maximized, at `about:blank`. The profile lives on the bot's
persistent workspace volume, so signed-in sites survive a container restart. The script is idempotent,
so running it twice leaves one of each. The container's CMD runs it, then `sleep infinity`.

`/usr/local/bin/brot-browser <command> [json-args]` is a small Node script that uses playwright-core
`chromium.connectOverCDP('http://127.0.0.1:9222')`. It prints one JSON object on stdout:

| command | args | result |
|---|---|---|
| `open` | `{url}` | `{url,title}` |
| `snapshot` | `{}` | `{url,title,text}`: an indented accessibility tree. Every interactive node carries `[ref=N]`. Refs stay valid until the next `snapshot`. At most 40 kB |
| `click` | `{ref}` | `{url,title}` |
| `type` | `{ref,text,submit?}` | `{url,title}` |
| `key` | `{key}` | `{url,title}` (`Enter`, `Tab`, `Escape`, `PageDown`…) |
| `scroll` | `{direction:'up'\|'down'}` | `{url,title}` |
| `back` | `{}` | `{url,title}` |
| `tabs` | `{}` | `{tabs:[{index,url,title,active}]}` |

## Server

The provider adds the desktop variant. For a bot with `desktop: true` it uses `brot-desktop:latest`,
starts the desktop at container start, and folds `desktop` into the container fingerprint, so
switching the flag recreates the container while the workspace volume persists.

### HTTP API (all under the existing device auth; input and takeover need a `full` device)

| Method | Path | Body | Result |
|---|---|---|---|
| GET | `/api/bots/:id/computer` | | `{ state: ComputerState \| 'none', desktop: boolean, width, height, takeover: Takeover \| null }` |
| POST | `/api/bots/:id/computer/start` | | same shape. Starts the computer (and desktop) if stopped |
| GET | `/api/bots/:id/computer/screen` | | `image/jpeg`, the current frame (quality ~70). `Cache-Control: no-store`. 404 when the bot has no desktop, 409 when the computer is not running |
| POST | `/api/bots/:id/computer/input` | `ComputerInput` | 204. 409 unless a takeover is active |
| POST | `/api/bots/:id/computer/takeover` | `SetTakeover` | `Takeover`. Emits `computer.takeover` on the bot's most recent thread |
| GET | `/api/providers` | | `[{ id, label, models: [{ id, label }], configured: boolean, secretName }]`. `configured` means the vault holds `secretName` |

The web polls `/screen` about four times a second while the computer panel is open, and stops when it
is hidden.

### Brot MCP tools (only for desktop bots)

| tool | risk | notes |
|---|---|---|
| `browser_open` `{url}` | read | navigation is a read. Egress still applies |
| `browser_snapshot` `{}` | read | returns the snapshot text |
| `browser_click` `{ref}` | write | |
| `browser_type` `{ref,text,submit?}` | write | refuses a `secret://` ref, a password field, or a card field. Those go through takeover |
| `browser_key` `{key}` | write | |
| `browser_scroll` `{direction}` | read | |
| `browser_back` `{}` | read | |
| `computer_screenshot` `{}` | read | returns an MCP image content block (`image/jpeg`) |
| `request_takeover` `{reason}` | read | sets takeover `{active:true, requestedBy:'bot'}`, notifies the user, and **waits** (polling, up to 15 min) until the person hands control back. Then it returns `"Control is back. Take a new snapshot."` |

While a takeover is active, every browser and computer tool except `request_takeover` returns
`"The person has control of the computer right now. Wait, or call request_takeover."` without
acting. An irreversible step (submitting a purchase, a payment or a post) still goes through the broker
as an approval. The bot asks with `http_request` semantics, or the person finishes it during a
takeover.

## Clients

- **Web (`apps/web`)**: the context panel's computer section shows the live screen with a status
  line (what the bot is doing: the last browser tool call) and a **Take control** / **Give control back**
  button. During a takeover the screen becomes interactive: clicks, scroll and typed keys go to
  `/input`, and a colored ring marks that the person is driving. When the bot calls
  `request_takeover`, the panel opens itself and shows the bot's reason.
- **Mobile**: view-only screen, plus the take-control and give-back buttons.

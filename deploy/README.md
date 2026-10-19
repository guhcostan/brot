# Self-hosting the Brot server

`compose.yaml` builds and runs the server from the repository `Dockerfile`. The API and live events listen on port 8799. The first boot seeds a bot named Capy, which runs on the mock engine.

## Run

From the repository root:

```bash
docker compose -f deploy/compose.yaml up -d --build
curl http://127.0.0.1:8799/api/health
docker compose -f deploy/compose.yaml logs -f server
docker compose -f deploy/compose.yaml down        # keeps the brot-data volume
```

## Data and networking

- All state lives in the `brot-data` named volume, mounted at `/data` (`BROT_HOME`). It holds the SQLite database and the vault. Back up this volume.
- Port 8799 is published on `127.0.0.1` only. Inside the container the server binds `0.0.0.0` (`BROT_HOST`), so the host can reach it through the published port and nothing else is exposed.
- Device auth stays on. Only loopback callers skip the token. Docker forwards host connections from a non-loopback address, so every host call needs a device token.
- The webhook listener on 8800 is not published. Publish it only when an external service must reach a webhook.

## Pairing the first device

Pairing starts only from loopback, so run it inside the container:

```bash
docker compose -f deploy/compose.yaml exec server node -e "fetch('http://127.0.0.1:8799/api/pairing/start',{method:'POST',headers:{'content-type':'application/json'}}).then(r=>r.text()).then(console.log)"
```

The response has a single-use `token` that expires after 120 seconds. Finish pairing from the device with `POST /api/pairing/complete` (`token`, `deviceName`, `publicKey`, `role`). The device then sends `Authorization: Bearer <deviceToken>`. The planned `brot` CLI will replace this step.

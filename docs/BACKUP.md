# Backup and restore

Brot keeps everything that matters in one directory, the **home** (`$BROT_HOME`, or `~/.brot` by default).
`brot backup` writes a portable copy of it and `brot restore` puts that copy back into a home.

```bash
brot backup                                   # into <home>/backups/brot-<timestamp>
brot backup --out /backups/brot-2026-10-23    # explicit destination
brot backup --no-secrets                      # leave the vault out
brot restore --from /backups/brot-2026-10-23  # into $BROT_HOME / ~/.brot
brot restore --from /backups/brot-2026-10-23 --home /srv/brot
```

`--home <dir>` overrides `$BROT_HOME` for both commands. With the repo checked out these are
`pnpm brot backup ...` and `pnpm brot restore ...`.

## What a backup contains

| Item | Notes |
|---|---|
| `brot.db` | A **consistent** SQLite snapshot, taken with `VACUUM INTO`. The WAL/SHM files are never copied, so a backup taken while the server is running is complete. |
| `attachments/` | Uploaded files, byte for byte. |
| `providers.json` | Custom model provider settings. Absent when you never added one. |
| `vault.json`, `vault.key` | The encrypted secrets vault. **Only with `--no-secrets` absent.** Written mode `0600` inside the backup. |
| `manifest.json` | `{ "format": "brot-backup", "version": 1, "createdAt": …, "includesSecrets": …, "files": [...] }`. |

The backup directory itself is created with mode `0700`. The command prints the destination, a size
estimate and whether secrets are included; when they are, treat the backup like the vault itself.

Not included, because they are machine state rather than Brot data:

- **Browser profiles** (`<home>/browser-profiles/`) — logins tied to this machine. A restored bot has to sign
  in again (or use the saved logins in the vault, which *are* included).
- **Docker containers and volumes** — `brot-computer-*` containers and `brot-workspace-*` volumes are
  recreated on the next run; workspace files living only in a container volume are not in the backup.
- Logs and the app shell: there is nothing to restore.

## Restoring

**Stop Brot before restoring.** The restore writes `brot.db` and the attachments under the home; a running
server has the database open and may write over them. Stop the CLI server, the desktop app, or
`docker compose -f deploy/compose.yaml down`, restore, then start it again.

`brot restore`:

1. reads and validates `manifest.json` (`format: "brot-backup"`, `version: 1`) and checks every file it lists;
2. refuses a non-empty target home unless `--force` is given (an existing `brot.db` counts as non-empty);
3. copies the snapshot, attachments, providers and vault (vault files mode `0600`), and removes stale
   `brot.db-wal`/`brot.db-shm` files;
4. opens the restored database and runs the migrations, then prints the bot and thread counts as proof the
   database is usable.

The backup directory is only read; it is never modified. After a successful restore start Brot the usual way
and check **Settings → Model providers** if the backup came from another machine.

## Requirements and limits

- Backups are tied to Brot's backup format version. A newer backup than the CLI understands is refused
  instead of being restored partially.
- The vault key and the encrypted vault must be restored together; restoring only `vault.json` cannot decrypt
  anything.
- The `--force` flag is for writing into a directory that already has files (backup) or into a home that
  already has a database (restore). It never deletes unrelated files in the target.
- Restoring verifies the schema by migrating, but does not verify model keys or Docker images; add those as
  usual after a move to a new machine.

## Scheduled backups (server)

The server can back itself up on a schedule. Settings live in the database under the `backups` key and are
available from the app (Settings → Backups) and the API:

```json
{
  "enabled": false,
  "intervalHours": 24,
  "keep": 5,
  "lastRunAt": "2026-10-23T05:00:00.000Z",
  "lastBackupName": "brot-2026-10-23T05:00:00.000Z",
  "lastError": "database is locked"
}
```

- `enabled` defaults to `false`. Turning it on and saving is enough: a backup with no previous run is due at the
  next check.
- `intervalHours` is 1..168 (default 24) and `keep` is 1..30 (default 5). Each scheduled run creates a backup and
  then prunes older ones, keeping the newest `keep`.
- The server checks every 15 minutes while it runs (an unref'd timer, so it never keeps the process alive). A
  failure is stored in `lastError` and never crashes the server; the next successful run clears it.
- Scheduled backups **include the vault** (they are local, same-machine snapshots) and live in
  `<home>/backups/brot-<timestamp>`. They are only listed by name, size and secret flag — never by path or
  content.
- Successful scheduled runs record `Created scheduled backup` in the admin activity log; saving the settings
  records `Updated backup settings`, and a manual run records `Created backup`.

API (all under the normal device auth):

```http
GET  /api/backups          # { settings, backups: [{ name, createdAt, sizeBytes, includesSecrets }], nextRunAt? }
PUT  /api/backups          # { enabled?, intervalHours?, keep? } -> saved settings
POST /api/backups/run      # create one backup now -> its entry (201)
```

`nextRunAt` is present while scheduled backups are enabled. `POST /api/backups/run` works whether or not the
schedule is enabled and counts as the last run, so it also pushes the next scheduled backup out by one interval.
The API never returns file paths, database bytes or vault contents.

The scheduled timer only exists in the long-running server (`brot serve`, the desktop app, the Docker image). The
CLI's `brot backup` remains the way to take a backup of a stopped or standalone home, and the same
`<home>/backups` history is listed by both.

## Restoring a scheduled backup

Scheduled backups are ordinary backups: stop the server, then

```bash
brot restore --from ~/.brot/backups/brot-2026-10-23T05:00:00.000Z --home ~/.brot --force
```

Restore validates the manifest, copies the files, migrates the database and prints the bot/thread counts.

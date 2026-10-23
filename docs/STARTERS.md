# Starter teams

Brot ships three ready-made teams you can install into an empty (or busy) workspace with one click. They are
ordinary team packages — the same format `brot` exports — so nothing about an installed team is special: every
bot, team, room, skill and routine can be edited, renamed or deleted afterwards.

| Id | Name | Roster | Room | Skill | Routine |
|---|---|---|---|---|---|
| `dev-team` | Dev team | Capy (Chief of Staff), Onça (Engineer), Lobo (Reviewer) | Build room | Unified diff | Daily repo check (Onça, weekdays 09:00) |
| `content-studio` | Content studio | Arara (Editor), Mico (Researcher), Boto (Social) | Editorial room | Hook checklist | Weekly content review (Arara, Mondays 10:00) |
| `ops-desk` | Ops desk | Tamu (Support triage), Jabuti (Finance) | Ops room | Refund triage | Morning brief (Tamu, weekdays 08:00) |

Every package is a team with a chief, bots assigned to it, a room whose lead is the chief, one shared skill and one
routine. Routines are always installed **paused** (`enabled: false`) — review the schedule, then turn it on. The
packages deliberately carry no engine, model or computer choices: installed bots get whatever the server uses by
default (the same defaults as creating a bot by hand), so a starter installs the same way on a desktop app and a
self-hosted server.

## API

```http
GET  /api/team-packages/starters
POST /api/team-packages/starters/:id/install
```

`GET` returns the static library (no database access):

```json
[
  {
    "id": "dev-team",
    "name": "Dev team",
    "description": "A chief of staff, an engineer and a reviewer who ship together and check the repository every weekday.",
    "teamCount": 1,
    "botCount": 3,
    "roomCount": 1,
    "routineCount": 1,
    "skillCount": 1
  }
]
```

`POST .../install` imports the package through the normal team-package importer and returns the created counts:

```json
{ "teams": 1, "bots": 3, "rooms": 1, "routines": 1, "skills": 1 }
```

- Status `201` on success, `404` for an unknown starter id, `400` only if a built-in package ever failed validation
  (the packages are covered by tests, so this should not happen), `500` if the write was rolled back.
- Installing the same starter twice is allowed: it creates a second, independent copy with fresh ids.
- Each install writes one entry to the admin activity log:
  `Installed starter team "<name>"` (`action: created`, `targetType: team-package`, `targetId: <starter id>`).
  No events are published; the web refreshes its lists.

## Relationship to import/export

The install route feeds `TeamPackage` objects to the same importer as `POST /api/team-packages/import`, so all the
existing rules apply: team/bot/room/skill/routine keys are re-resolved to new ids, unknown avatars are omitted, a
failed write rolls back what the install created, and routines are created paused. Exporting an installed team gives
you a portable package you can share or install elsewhere.

The built-in definitions live in `apps/server/src/team-packages/starters.ts`; adding a fourth starter means adding
one entry there (its package is validated by the protocol schema at module load) and covering it in
`starters.test.ts`.

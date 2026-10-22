# Team API (wave 5b contract)

REST additions. Bodies are validated with the zod schemas in `@brot/protocol` (`CreateRoom`, `UpdateRoomMembers`, `CreateTask`, `UpdateTask`).

| Method | Path | Body / query | Returns |
|---|---|---|---|
| POST | `/api/rooms` | `CreateRoom` | `Thread` (kind `room`), emits `room.members` |
| GET | `/api/rooms` | — | `Thread[]` (rooms only) |
| GET | `/api/rooms/:id/members` | — | `RoomMember[]` |
| PATCH | `/api/rooms/:id/members` | `UpdateRoomMembers` | `RoomMember[]`, emits `room.members` |
| GET | `/api/bots/:id/threads` | `?kind=dm\|room` | `Thread[]` (the web client uses `kind=dm` for a bot's DM) |
| POST | `/api/threads/:id/messages` | `PostMessage` (+ optional `mentions: string[]`) | as today. In rooms, `@Name` in the content is resolved to member bot ids server-side |
| GET | `/api/threads/:id/events` | `?after=<eventId>` | `CanonicalEvent[]` from the log, oldest first |
| GET | `/api/tasks` | `?assigneeBotId&status&chainId&threadId` | `Task[]` |
| POST | `/api/tasks` | `CreateTask` | `Task` created by the user (depth 0), emits `task.created`, starts the assignee |
| GET | `/api/tasks/:id` | — | `Task` (+ `children: Task[]`) |
| PATCH | `/api/tasks/:id` | `UpdateTask` | `Task`, emits `task.updated` |

Repo rule violations (depth, chain size, terminal status) map to `409`.

## Room routing
- `responder: mention`: only mentioned member bots run, in mention order.
- `responder: lead`: mentioned bots run; with no mention the lead bot runs.
- Each bot in a room has its own engine session (`thread_sessions`) and sees the whole room history, with each message labeled by author.
- Assistant messages carry `authorBotId`. Messages a bot sends to another carry `authorBotId` (sender) and `viaBotId` (recipient).

## Team MCP tools (available to every bot's run through the Brot MCP server)
| Tool | Effect | Broker |
|---|---|---|
| `list_team` | Bots the caller can work with (all non-archived bots; in a room, members first) | read, policy may auto-allow |
| `ask_bot` | Runs the target bot in the caller's thread (room) or a bot-to-bot exchange; returns its answer. Emits `bot.asked` / `bot.answered` | write |
| `delegate_task` | Creates a `Task` for the target (depth+1 in the caller's chain), starts it in the target's DM thread, returns the task id | write |
| `update_my_task` | Assignee reports progress/result on its own task; on `done`/`failed` the result is posted back to the task's thread | write |
| `handoff` | In a room, passes the baton: the target becomes the next responder. Emits `handoff` | write |

Guards: `TEAM_MAX_DEPTH`, `TEAM_MAX_TASKS_PER_CHAIN`, `TEAM_MAX_ASK_HOPS`, a bot cannot ask/delegate to itself, no cycles within one ask chain, `teamBudgetUsd` (smallest cap in the chain) stops new work in the chain once spent. Delegation never widens permissions: the target runs with its own policies, egress and computer. A bot never answers another bot's approval.

## Identity, guidance and limits

- Every DSH session starts with an identity preamble: "You are <name>, <job>", the bot's instructions, and in rooms the room title, members with jobs, the lead, the responder mode, and "Messages labeled [Name] were written by that bot". Resumed room turns are prefixed with `[You are <name>]`. Without this, bots in a room took each other's identity (found in eval B6).
- When team tools are attached, the preamble explains when to use each one; the tool descriptions say the same.
- Per-run caps (a tool error past the cap): `list_team` 1, `ask_bot` 3, `delegate_task` 6, `update_my_task` 5, `handoff` 3.
- Each room message opens one chain shared by all its replies and the work they delegate. Budget: the smallest `teamBudgetUsd` in the chain, else `BROT_TEAM_CHAIN_BUDGET_USD` (default 1.00). When it is spent, new work in the chain stops and a system note is posted in the room.
- A task ends exactly once, either through `update_my_task` or when its work run settles (done with the final text, or failed/cancelled). Its result is posted to the task's thread and the delegator is notified once, queued behind any run it already has in that thread.

export const PROTOCOL_VERSION = 1;

export const DEFAULT_SERVER_PORT = 8799;
export const DEFAULT_WEBHOOK_PORT = 8800;
export const DEFAULT_WEB_PORT = 5199;

/** Fewest bots in a room. A thread with one bot is a DM. */
export const MIN_ROOM_BOTS = 2;
/** Most bots in a room, the lead bot included. */
export const MAX_ROOM_BOTS = 12;

/**
 * Deepest level of a delegation chain. A user-created task is depth 0, and each delegation adds one.
 * The server refuses a delegation that would go deeper.
 */
export const TEAM_MAX_DEPTH = 3;
/** Most tasks one chain may hold, the root task included. A chain is every task that shares a `chainId`. */
export const TEAM_MAX_TASKS_PER_CHAIN = 20;
/**
 * Most `ask_bot` calls that may nest in one exchange. A question from the bot the user is talking to is
 * hop 1. A call that would make hop 5 is refused.
 */
export const TEAM_MAX_ASK_HOPS = 4;

/** Size of a bot desktop's screen, in pixels. */
export const DESKTOP_WIDTH = 1280;
export const DESKTOP_HEIGHT = 800;

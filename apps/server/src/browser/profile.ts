import { chmod, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { assertBotId } from '../computers/docker-args';

/** Only the server user can read a browser profile: it holds cookies and saved sessions. */
const PROFILE_MODE = 0o700;

/**
 * A bot's Chrome profile directory: `<home>/browser-profiles/<botId>`. The bot id is checked with the same
 * rule as container names, so it cannot escape the profiles directory.
 */
export function profileDir(home: string, botId: string): string {
  try {
    assertBotId(botId);
  } catch {
    throw new Error('bot id cannot be used as a browser profile directory name');
  }
  return join(home, 'browser-profiles', botId);
}

/** Creates the bot's profile directory if needed and makes sure only the server user can use it. */
export async function ensureProfileDir(home: string, botId: string): Promise<string> {
  const dir = profileDir(home, botId);
  await mkdir(dir, { recursive: true, mode: PROFILE_MODE });
  // mkdir's mode is filtered through the umask, and a pre-existing directory keeps its old bits.
  await chmod(dir, PROFILE_MODE);
  return dir;
}

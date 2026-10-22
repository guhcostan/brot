import { chmod, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { assertBotId } from '../computers/docker-args';

/** Only the server user can read a browser profile: it holds cookies and saved sessions. */
const PROFILE_MODE = 0o700;

/**
 * A browser profile directory: `<home>/browser-profiles/<key>`. The key is a shared browser profile id, or the
 * bot id for a bot's own profile (the layout every existing profile already has). The key is checked with the
 * same rule as container names, so it cannot escape the profiles directory.
 */
export function profileDir(home: string, key: string): string {
  try {
    assertBotId(key);
  } catch {
    throw new Error('profile key cannot be used as a browser profile directory name');
  }
  return join(home, 'browser-profiles', key);
}

/** Creates the profile directory if needed and makes sure only the server user can use it. */
export async function ensureProfileDir(home: string, key: string): Promise<string> {
  const dir = profileDir(home, key);
  await mkdir(dir, { recursive: true, mode: PROFILE_MODE });
  // mkdir's mode is filtered through the umask, and a pre-existing directory keeps its old bits.
  await chmod(dir, PROFILE_MODE);
  return dir;
}

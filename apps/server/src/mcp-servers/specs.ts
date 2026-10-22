import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { delimiter, isAbsolute, resolve } from 'node:path';
import type { Repos } from '@brot/db';
import {
  HttpMcpServer,
  StdioMcpServer,
  secretNameOf,
  type Bot,
  type McpServer,
  type McpServerSpec,
} from '@brot/protocol';
import type { Vault } from '../vault';

/** `McpServerSpec` caps its name at 32 characters; a longer user name gets a stable hash suffix to stay unique. */
export function mcpSpecName(name: string): string {
  if (name.length <= 32) return name;
  const suffix = createHash('sha256').update(name).digest('base64url').slice(0, 6);
  return `${name.slice(0, 25)}-${suffix}`;
}

/**
 * Resolves the `secret://` values of an env map through the vault. A reference the vault cannot resolve is
 * omitted, so the child process starts without that variable instead of with the literal reference.
 */
export async function resolveEnv(
  env: Record<string, string>,
  vault: Pick<Vault, 'resolveRef'>,
): Promise<Record<string, string>> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    const secretName = secretNameOf(value);
    if (secretName === undefined) {
      resolved[key] = value;
      continue;
    }
    const secret = await vault.resolveRef(`secret://${secretName}`);
    if (secret !== undefined) resolved[key] = secret;
  }
  return resolved;
}

/** The absolute path of a stdio server's command, or why it could not be found. */
export type CommandResolution = { ok: true; command: string } | { ok: false; error: string };

/** Why a stored server cannot become an engine spec. Its message holds the command, never an env value. */
export class McpServerUnavailableError extends Error {}

const WINDOWS_EXECUTABLE_EXTENSIONS = ['.exe', '.cmd', '.bat'] as const;

/**
 * Finds the absolute path of a stdio command. The engine refuses a relative command, so a bare `node` is
 * looked up on this server's PATH. A command with no path separator is searched in every PATH directory.
 */
export async function resolveCommand(command: string): Promise<CommandResolution> {
  const name = command.trim();
  if (name === '') return { ok: false, error: 'the command is empty' };
  if (isAbsolute(name)) {
    return (await isExecutableFile(name))
      ? { ok: true, command: name }
      : { ok: false, error: `command "${name}" does not exist or is not executable` };
  }
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (dir === '') continue;
    for (const candidate of candidateNames(name)) {
      const file = resolve(dir, candidate);
      if (await isExecutableFile(file)) return { ok: true, command: file };
    }
  }
  return { ok: false, error: `command "${name}" was not found in PATH` };
}

function candidateNames(command: string): string[] {
  if (process.platform !== 'win32') return [command];
  return [command, ...WINDOWS_EXECUTABLE_EXTENSIONS.map((extension) => `${command}${extension}`)];
}

async function isExecutableFile(file: string): Promise<boolean> {
  try {
    if (!(await stat(file)).isFile()) return false;
    await access(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * The engine spec for a stored server. `env` must already be resolved: it goes straight into the child
 * process. A stdio command is made absolute here, because the engine refuses a relative one.
 */
export async function mcpServerSpec(server: McpServer, env: Record<string, string>): Promise<McpServerSpec> {
  const name = mcpSpecName(server.name);
  if (server.transport === 'stdio') {
    const lookup = await resolveCommand(server.command ?? '');
    if (!lookup.ok) throw new McpServerUnavailableError(lookup.error);
    return StdioMcpServer.parse({ name, command: lookup.command, args: server.args, env });
  }
  return HttpMcpServer.parse({ name, url: server.url, headers: {} });
}

/**
 * Every enabled user MCP server this bot may use, as engine specs, with secret env values resolved for this run.
 * `bot.mcpServerIds` is the grant: absent or null attaches every enabled server, an array is an allowlist
 * (empty means none) and ids that name no server are ignored. A stored row that cannot become a valid spec is
 * skipped rather than failing the run. The log names the server, and the command when that is the problem; it
 * never holds an env value.
 */
export async function enabledMcpServerSpecs(
  repos: Pick<Repos, 'mcpServers'>,
  vault: Pick<Vault, 'resolveRef'>,
  bot: Pick<Bot, 'mcpServerIds'>,
): Promise<McpServerSpec[]> {
  const grant = bot.mcpServerIds;
  const allow = grant === undefined || grant === null ? undefined : new Set(grant);
  const specs: McpServerSpec[] = [];
  for (const server of await repos.mcpServers.listEnabled()) {
    if (allow !== undefined && !allow.has(server.id)) continue;
    try {
      specs.push(await mcpServerSpec(server, await resolveEnv(server.env, vault)));
    } catch (error) {
      const reason = error instanceof McpServerUnavailableError ? `: ${error.message}` : '';
      console.error(`MCP server "${server.name}" could not be attached to the run${reason}`);
    }
  }
  return specs;
}

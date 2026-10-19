import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { EngineDriver } from '@brot/protocol';
import { ServerUnreachableError, type BrotClient } from '../client';
import { writeJsonLine, type Writer } from '../io';

export const MIN_NODE_MAJOR = 24;
const SERVER_CHECK_TIMEOUT_MS = 2_000;

export type CheckStatus = 'ok' | 'warn' | 'fail';

export interface Check {
  check: string;
  status: CheckStatus;
  required: boolean;
  detail: string;
}

export interface DoctorDeps {
  home: string;
  nodeVersion: string;
  engines: EngineDriver[];
  client: BrotClient;
  stdout: Writer;
  json: boolean;
}

/** Prints one line per check and returns 1 when a required check fails, 0 otherwise. */
export async function runDoctor(deps: DoctorDeps): Promise<number> {
  const checks: Check[] = [
    checkNode(deps.nodeVersion),
    await checkHome(deps.home),
    ...(await Promise.all(deps.engines.map(checkEngine))),
    await checkServer(deps.client),
  ];

  for (const check of checks) {
    if (deps.json) {
      writeJsonLine(deps.stdout, check);
    } else {
      deps.stdout.write(`${check.status.padEnd(5)}${check.check}: ${check.detail}\n`);
    }
  }
  return checks.some((check) => check.status === 'fail') ? 1 : 0;
}

function checkNode(version: string): Check {
  const major = Number(version.split('.')[0]);
  const ok = major >= MIN_NODE_MAJOR;
  return {
    check: 'node',
    status: ok ? 'ok' : 'fail',
    required: true,
    detail: ok ? `v${version}` : `v${version}; Brot needs Node ${MIN_NODE_MAJOR} or newer`,
  };
}

/**
 * Checks that the home directory exists and is writable, or that its nearest existing ancestor is.
 * Only inspects permissions; it never creates or writes anything.
 */
async function checkHome(home: string): Promise<Check> {
  const fail = (detail: string): Check => ({ check: 'brot_home', status: 'fail', required: true, detail });
  let dir = home;
  for (;;) {
    try {
      if (!(await stat(dir)).isDirectory()) return fail(`${dir} exists but is not a directory`);
      await access(dir, constants.W_OK);
      const detail = dir === home ? home : `${home} will be created in ${dir}`;
      return { check: 'brot_home', status: 'ok', required: true, detail };
    } catch (error) {
      if (!isNotFound(error)) return fail(`${dir} is not writable (${errorText(error)})`);
      const parent = dirname(dir);
      if (parent === dir) return fail(`no existing parent for ${home}`);
      dir = parent;
    }
  }
}

async function checkEngine(driver: EngineDriver): Promise<Check> {
  const check = `engine ${driver.id}`;
  try {
    const availability = await driver.detect();
    if (availability.available) {
      return { check, status: 'ok', required: false, detail: availability.version ?? 'available' };
    }
    return { check, status: 'warn', required: false, detail: availability.reason ?? 'unavailable' };
  } catch (error) {
    return { check, status: 'warn', required: false, detail: `detection failed (${errorText(error)})` };
  }
}

async function checkServer(client: BrotClient): Promise<Check> {
  try {
    const health = await client.health(AbortSignal.timeout(SERVER_CHECK_TIMEOUT_MS));
    return {
      check: 'server',
      status: 'ok',
      required: false,
      detail: `${client.baseUrl} runs Brot ${health.version} (protocol ${health.protocol})`,
    };
  } catch (error) {
    const detail =
      error instanceof ServerUnreachableError
        ? `nothing answers at ${client.baseUrl}; start one with "brot serve" or pass --url`
        : `${client.baseUrl} did not pass its health check (${errorText(error)})`;
    return { check: 'server', status: 'warn', required: false, detail };
  }
}

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

import { execFile, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { EngineAvailability, EngineEvent } from '@brot/protocol';

const PROBE_TIMEOUT_MS = 10_000;
const STDERR_KEEP_CHARS = 2_000;
const STDERR_SHOWN_CHARS = 500;

/** Runs `<bin> --version`. Any failure, including a missing binary, reports unavailable. */
export function probeCli(bin: string, missingReason: string): Promise<EngineAvailability> {
  return new Promise((resolve) => {
    execFile(bin, ['--version'], { timeout: PROBE_TIMEOUT_MS }, (error, stdout) => {
      if (error) {
        resolve({ available: false, reason: missingReason });
        return;
      }
      const version = /\d+\.\d+\.\d+\S*/.exec(stdout)?.[0] ?? (stdout.trim() || undefined);
      resolve(version ? { available: true, version } : { available: true });
    });
  });
}

export interface CliStreamOptions {
  label: string;
  bin: string;
  args: string[];
  signal: AbortSignal;
  parseLine: (line: string) => EngineEvent[];
  /** Returns a message when the line reports a failed run; the stream then throws it. */
  fatalLine: (line: string) => string | undefined;
}

/**
 * Spawns a CLI and yields events parsed from its stdout, one JSON line at a time.
 * Aborting kills the child and ends the stream without throwing.
 */
export async function* streamCli(opts: CliStreamOptions): AsyncGenerator<EngineEvent> {
  const child = spawn(opts.bin, opts.args, { stdio: ['ignore', 'pipe', 'pipe'] });

  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-STDERR_KEEP_CHARS);
  });

  let spawnError: Error | undefined;
  const exited = new Promise<number | null>((resolve) => {
    child.once('error', (error) => {
      spawnError = error;
      resolve(null);
    });
    child.once('close', (code) => resolve(code));
  });

  const kill = (): void => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  };
  const onAbort = (): void => {
    kill();
    lines.close();
  };
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  if (opts.signal.aborted) onAbort();
  else opts.signal.addEventListener('abort', onAbort, { once: true });

  let fatal: string | undefined;
  let finished = false;
  try {
    for await (const line of lines) {
      fatal ??= opts.fatalLine(line);
      for (const event of opts.parseLine(line)) yield event;
    }
    finished = true;
  } finally {
    opts.signal.removeEventListener('abort', onAbort);
    lines.close();
    if (!finished) kill();
  }

  if (opts.signal.aborted) return;
  const code = await exited;
  if (spawnError) throw new Error(`${opts.label} CLI failed to start: ${spawnError.message}`);
  if (fatal) throw new Error(`${opts.label} run failed: ${fatal}`);
  if (code !== 0) {
    const tail = stderr.trim().slice(-STDERR_SHOWN_CHARS);
    throw new Error(`${opts.label} exited with code ${code}${tail ? `: ${tail}` : ''}`);
  }
}

export function parseJsonLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

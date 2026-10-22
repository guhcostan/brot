import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { spawn } from 'node:child_process';

/** The binaries the system provider uses. */
export type SystemBinary = 'say' | 'afconvert';

/** What one command returned. The output files are read by the caller. */
export interface SpeechCommandResult {
  code: number;
  stderr: string;
}

/** Runs one system speech command. Tests inject a fake that writes the expected output file. */
export interface SpeechRunner {
  run(argv: string[]): Promise<SpeechCommandResult>;
}

/** Whether a system speech binary exists. Injectable so tests need no macOS commands. */
export type BinaryCheck = (name: SystemBinary) => Promise<boolean>;

const KNOWN_BINARIES: Record<SystemBinary, readonly string[]> = {
  say: ['/usr/bin/say'],
  afconvert: ['/usr/bin/afconvert'],
};

async function isExecutable(file: string): Promise<boolean> {
  try {
    await access(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Looks for the macOS speech binaries in their usual place, then on PATH. */
export async function binaryAvailable(name: SystemBinary): Promise<boolean> {
  for (const known of KNOWN_BINARIES[name]) {
    if (await isExecutable(known)) return true;
  }
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (dir === '') continue;
    if (await isExecutable(join(dir, name))) return true;
  }
  return false;
}

/** The real runner: spawns the command with stderr captured, and never prints it. */
export function spawnSpeechRunner(): SpeechRunner {
  return {
    run(argv) {
      const [command, ...args] = argv;
      if (command === undefined) return Promise.resolve({ code: 1, stderr: 'missing command' });
      return new Promise((resolve) => {
        const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
        let stderr = '';
        child.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        child.once('error', (error) => resolve({ code: 1, stderr: error.message }));
        child.once('close', (code) => resolve({ code: code ?? 1, stderr }));
      });
    },
  };
}

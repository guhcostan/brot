import type { ChildProcess } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import type { ComputerExit, ComputerProcess } from '@brot/protocol';

const noop = (): void => undefined;

/**
 * Wraps a child process with piped stdio as a ComputerProcess. Stream errors are swallowed at the edge: a
 * process that exits closes its pipes, and that is reported through `exit`, not as an unhandled error.
 */
export function toComputerProcess(
  child: ChildProcess,
  kill: (signal: 'SIGTERM' | 'SIGKILL') => void,
): ComputerProcess {
  const { stdin, stdout, stderr } = child;
  if (stdin === null || stdout === null || stderr === null) throw new Error('child process needs piped stdio');
  stdin.on('error', noop);
  stdout.on('error', noop);
  stderr.on('error', noop);
  const exit = new Promise<ComputerExit>((resolve) => {
    child.once('error', () => resolve({ code: 127, signal: null }));
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  return {
    stdin: Writable.toWeb(stdin) as WritableStream<Uint8Array>,
    stdout: Readable.toWeb(stdout) as ReadableStream<Uint8Array>,
    stderr: Readable.toWeb(stderr) as ReadableStream<Uint8Array>,
    exit,
    kill: (signal = 'SIGTERM') => kill(signal),
  };
}

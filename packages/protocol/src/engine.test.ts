import { describe, expect, it } from 'vitest';
import type { ComputerExit, ComputerHandle, ComputerProcess, EngineEvent, RunContext } from './engine';

/** A process whose stdout echoes stdin, standing in for a local spawn or a docker exec stream. */
function echoProcess(): ComputerProcess {
  let push: (chunk: Uint8Array) => void = () => undefined;
  let close: () => void = () => undefined;
  const stdout = new ReadableStream<Uint8Array>({
    start(controller) {
      push = (chunk) => controller.enqueue(chunk);
      close = () => controller.close();
    },
  });

  let settle: (exit: ComputerExit) => void = () => undefined;
  const exit = new Promise<ComputerExit>((resolve) => {
    settle = resolve;
  });
  let ended = false;
  const end = (result: ComputerExit) => {
    if (ended) return;
    ended = true;
    close();
    settle(result);
  };

  return {
    stdin: new WritableStream<Uint8Array>({
      write: (chunk) => {
        push(chunk);
      },
      close: () => end({ code: 0, signal: null }),
    }),
    stdout,
    stderr: new ReadableStream<Uint8Array>({ start: (controller) => controller.close() }),
    exit,
    kill: () => end({ code: null, signal: 'SIGTERM' }),
  };
}

describe('ComputerHandle contract', () => {
  it('can be implemented by a stream-backed process and passed to a RunContext', async () => {
    const computer: ComputerHandle = {
      id: 'cmp_1',
      exec: async (cmd, opts) => {
        expect(cmd).toEqual(['node', '--version']);
        expect(opts).toEqual({ cwd: '/work', env: { HOME: '/home/brot' } });
        return echoProcess();
      },
    };

    const ctx = { computer } as Pick<RunContext, 'computer'>;
    const process = await ctx.computer?.exec(['node', '--version'], { cwd: '/work', env: { HOME: '/home/brot' } });
    expect(process).toBeDefined();

    const writer = process!.stdin.getWriter();
    await writer.write(new TextEncoder().encode('ping'));
    await writer.close();

    const reader = process!.stdout.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe('ping');

    expect(await process!.exit).toEqual({ code: 0, signal: null });
  });

  it('reports a kill through the exit promise', async () => {
    const process = echoProcess();
    process.kill('SIGKILL');
    expect(await process.exit).toEqual({ code: null, signal: 'SIGTERM' });
  });
});

describe('EngineEvent', () => {
  it('carries the engine session to persist', () => {
    const event: EngineEvent = { type: 'engine.session', sessionId: 'sess_9' };
    expect(event.type).toBe('engine.session');
  });
});

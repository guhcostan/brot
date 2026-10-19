import { describe, expect, it, vi } from 'vitest';
import type { ServerHandle, StartOptions } from '@brot/server';
import { capture } from '../testing';
import { runServe } from './serve';

function fakeHandle(): ServerHandle {
  return {
    host: '127.0.0.1',
    port: 4321,
    webhookPort: 4322,
    app: {} as ServerHandle['app'],
    close: vi.fn(async () => undefined),
  };
}

describe('runServe', () => {
  it('starts the server, reports where it listens, and closes it when asked to stop', async () => {
    const handle = fakeHandle();
    const starts: StartOptions[] = [];
    const stdout = capture();
    const controller = new AbortController();

    const running = runServe(
      { host: '127.0.0.1', port: 0 },
      {
        start: async (options) => {
          starts.push(options);
          return handle;
        },
        stdout,
        signal: controller.signal,
      },
    );
    await vi.waitFor(() => expect(stdout.text()).not.toBe(''));
    controller.abort();

    expect(await running).toBe(0);
    expect(starts).toEqual([{ host: '127.0.0.1', port: 0 }]);
    expect(stdout.text()).toBe('Brot server listening on http://127.0.0.1:4321 (webhooks on :4322)\n');
    expect(handle.close).toHaveBeenCalledOnce();
  });

  it('passes unset options through so the server reads its environment', async () => {
    const starts: StartOptions[] = [];
    const controller = new AbortController();
    controller.abort();

    await runServe(
      {},
      {
        start: async (options) => {
          starts.push(options);
          return fakeHandle();
        },
        stdout: capture(),
        signal: controller.signal,
      },
    );

    expect(starts).toEqual([{ host: undefined, port: undefined }]);
  });
});

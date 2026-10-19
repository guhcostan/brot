import type { ServerHandle, StartOptions } from '@brot/server';
import { untilAborted, type Writer } from '../io';

export interface ServeOptions {
  host?: string;
  port?: number;
}

export interface ServeDeps {
  start: (options: StartOptions) => Promise<ServerHandle>;
  stdout: Writer;
  signal: AbortSignal;
}

/** Runs the server in this process until the signal aborts, then closes it cleanly. */
export async function runServe(options: ServeOptions, deps: ServeDeps): Promise<number> {
  const handle = await deps.start({ host: options.host, port: options.port });
  deps.stdout.write(
    `Brot server listening on http://${handle.host}:${handle.port} (webhooks on :${handle.webhookPort})\n`,
  );
  await untilAborted(deps.signal);
  await handle.close();
  return 0;
}

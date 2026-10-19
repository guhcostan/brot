import { defaultEngines } from '@brot/engines';
import { startServer } from '@brot/server';
import { runCli } from './cli';

for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EPIPE') process.exit(0);
    throw error;
  });
}

const controller = new AbortController();
const stop = (): void => controller.abort();
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

process.exitCode = await runCli(process.argv.slice(2), {
  env: process.env,
  stdout: process.stdout,
  stderr: process.stderr,
  fetch: globalThis.fetch,
  signal: controller.signal,
  start: startServer,
  engines: defaultEngines(),
  nodeVersion: process.versions.node,
});

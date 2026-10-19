import { startRelay } from './relay';

function readPort(name: string, value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`${name} must be a port between 0 and 65535, got "${value}"`);
  }
  return port;
}

const relay = await startRelay({
  host: process.env.BROT_RELAY_HOST ?? '0.0.0.0',
  port: readPort('BROT_RELAY_PORT', process.env.BROT_RELAY_PORT),
});
console.log(`Brot relay listening on ws://${relay.host}:${relay.port}`);

let stopping = false;
const stop = (): void => {
  if (stopping) return;
  stopping = true;
  void relay.close().then(() => process.exit(0));
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

import { startServer } from './index';

const server = await startServer();
console.log(`Brot server listening on http://${server.host}:${server.port} (webhooks on :${server.webhookPort})`);

let stopping = false;
const stop = (): void => {
  if (stopping) return;
  stopping = true;
  void server.close().then(() => process.exit(0));
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

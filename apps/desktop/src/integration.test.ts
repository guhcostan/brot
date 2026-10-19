import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer, type ServerHandle } from '@brot/server';
import { afterEach, describe, expect, it } from 'vitest';
import { startWebGateway, type WebGateway } from './gateway';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe('embedded server behind the web gateway', () => {
  it('serves the app shell, the health route and the seeded bot through one origin', async () => {
    const home = await mkdtemp(join(tmpdir(), 'brot-desktop-home-'));
    const web = await mkdtemp(join(tmpdir(), 'brot-desktop-web-'));
    cleanups.push(() => rm(home, { recursive: true, force: true }));
    cleanups.push(() => rm(web, { recursive: true, force: true }));
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(web, 'index.html'), '<!doctype html><title>Brot</title>');

    const server: ServerHandle = await startServer({ home, host: '127.0.0.1', port: 0, webhookPort: 0 });
    cleanups.push(() => server.close());
    const gateway: WebGateway = await startWebGateway({ webRoot: web, port: 0, apiPort: server.port });
    cleanups.push(() => gateway.close());

    const page = await fetch(`${gateway.url}/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<title>Brot</title>');

    const health = await fetch(`${gateway.url}/api/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true, version: expect.any(String), protocol: 1 });

    const bots = (await (await fetch(`${gateway.url}/api/bots`)).json()) as Array<{ name: string }>;
    expect(bots.map((bot) => bot.name)).toContain('Capy');
  });
});

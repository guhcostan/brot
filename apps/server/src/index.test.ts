import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEngineRegistry, createMockEngine } from '@brot/engines';
import type { Bot, Run } from '@brot/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config';
import { startServer, type ServerHandle } from './index';
import { createServices } from './services';

const handles: ServerHandle[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.close();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function tempHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'brot-boot-'));
  dirs.push(dir);
  return dir;
}

async function boot(home: string): Promise<ServerHandle> {
  const handle = await startServer({ home, host: '127.0.0.1', port: 0, webhookPort: 0 });
  handles.push(handle);
  return handle;
}

describe('startServer', () => {
  it('listens on real ports, answers health, seeds Capy once, and keeps webhooks separate', async () => {
    const home = await tempHome();
    const server = await boot(home);
    const base = `http://127.0.0.1:${server.port}`;

    const health = await fetch(`${base}/api/health`);
    expect(await health.json()).toEqual({ ok: true, version: '0.1.0', protocol: 1 });

    const bots = (await (await fetch(`${base}/api/bots`)).json()) as Bot[];
    expect(bots).toEqual([
      expect.objectContaining({ name: 'Capy', job: 'Chief of Staff', engine: 'mock' }),
    ]);

    const webhookHealth = await fetch(`http://127.0.0.1:${server.webhookPort}/api/health`);
    expect(webhookHealth.status).toBe(404);
    await server.close();
    handles.pop();

    const again = await boot(home);
    const botsAgain = (await (await fetch(`http://127.0.0.1:${again.port}/api/bots`)).json()) as Bot[];
    expect(botsAgain).toHaveLength(1);
  });

  it('marks runs interrupted by a restart as failed', async () => {
    const home = await tempHome();
    const config = loadConfig({ BROT_HOME: home });
    const services = await createServices(config, createEngineRegistry([createMockEngine()]));
    const bot = await services.repos.bots.create({ name: 'Ada', job: 'x' });
    const thread = await services.repos.threads.create(bot.id, { title: 'Chat' });
    const running = await services.repos.runs.create({ threadId: thread.id, botId: bot.id, engine: 'mock' });
    await services.repos.runs.update(running.id, { status: 'waiting_approval' });
    await services.close();

    const server = await boot(home);
    const runs = (await (await server.app.request(`/api/threads/${thread.id}/runs`)).json()) as Run[];
    expect(runs).toEqual([
      expect.objectContaining({ id: running.id, status: 'failed', error: 'server restarted' }),
    ]);
  });
});

import { mkdtemp, readFile, rm } from 'node:fs/promises';
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

  it('sweeps the files of attachments whose rows a deletion cascaded away, before it listens', async () => {
    const home = await tempHome();
    const config = loadConfig({ BROT_HOME: home });
    const services = await createServices(config, createEngineRegistry([createMockEngine()]));
    const kept = await services.repos.bots.create({ name: 'Kept', job: 'x' });
    const keptThread = await services.repos.threads.create(kept.id, { title: 'Keep' });
    const keptAttachment = await services.repos.attachments.create({
      threadId: keptThread.id,
      name: 'keep.txt',
      mimeType: 'text/plain',
      size: 4,
      sha256: 'b'.repeat(64),
    });
    await services.attachments.write(keptAttachment.id, new TextEncoder().encode('keep'));

    const doomed = await services.repos.bots.create({ name: 'Doomed', job: 'x' });
    const doomedThread = await services.repos.threads.create(doomed.id, { title: 'Bye' });
    const orphan = await services.repos.attachments.create({
      threadId: doomedThread.id,
      name: 'bye.txt',
      mimeType: 'text/plain',
      size: 3,
      sha256: 'a'.repeat(64),
    });
    await services.attachments.write(orphan.id, new TextEncoder().encode('bye'));
    await services.repos.bots.remove(doomed.id);
    await services.close();

    const server = await boot(home);
    expect((await fetch(`http://127.0.0.1:${server.port}/api/health`)).status).toBe(200);
    await expect(readFile(join(home, 'attachments', orphan.id))).rejects.toThrow();
    expect(await readFile(join(home, 'attachments', keptAttachment.id), 'utf8')).toBe('keep');
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

import type { Repos } from '@brot/db';
import { ComputerInput, SetTakeover } from '@brot/protocol';
import type { Hono, Context } from 'hono';
import type { AppEnv } from '../auth';
import { DesktopError, type DesktopService } from './service';

export interface DesktopRouteDeps {
  repos: Repos;
  desktop: DesktopService;
}

/** Mounts the bot desktop routes on the app. They sit under `/api/*`, so device auth applies first. */
export function mountDesktopRoutes(app: Hono<AppEnv>, deps: DesktopRouteDeps): void {
  const { repos, desktop } = deps;

  async function withBot(
    c: Context<AppEnv>,
    run: (bot: NonNullable<Awaited<ReturnType<Repos['bots']['get']>>>) => Promise<Response>,
  ): Promise<Response> {
    const bot = await repos.bots.get(c.req.param('id') ?? '');
    if (!bot) return c.json({ error: 'Bot not found' }, 404);
    try {
      return await run(bot);
    } catch (error) {
      if (error instanceof DesktopError) return c.json({ error: error.message }, error.status);
      throw error;
    }
  }

  async function readJson(c: Context<AppEnv>): Promise<unknown> {
    try {
      return await c.req.json();
    } catch {
      return undefined;
    }
  }

  app.get('/api/bots/:id/computer', (c) => withBot(c, async (bot) => c.json(await desktop.state(bot))));

  app.post('/api/bots/:id/computer/start', (c) => withBot(c, async (bot) => c.json(await desktop.start(bot))));

  app.get('/api/bots/:id/computer/screen', (c) =>
    withBot(c, async (bot) => {
      const jpeg = await desktop.screen(bot);
      const body = new Uint8Array(jpeg.byteLength);
      body.set(jpeg);
      return new Response(body, {
        headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-store' },
      });
    }),
  );

  app.post('/api/bots/:id/computer/input', (c) =>
    withBot(c, async (bot) => {
      const parsed = ComputerInput.safeParse(await readJson(c));
      if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);
      await desktop.input(bot, parsed.data);
      return c.body(null, 204);
    }),
  );

  app.post('/api/bots/:id/computer/takeover', (c) =>
    withBot(c, async (bot) => {
      const parsed = SetTakeover.safeParse(await readJson(c));
      if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);
      return c.json(await desktop.setTakeover(bot, parsed.data, 'user'));
    }),
  );
}

import type { Repos } from '@brot/db';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Scheduler } from './scheduler';

const MAX_PAYLOAD_BYTES = 256 * 1024;

/**
 * The webhook receiver runs on its own port. Its only route is POST /h/:secret, where the secret
 * identifies a webhook routine. Every other path answers 404.
 */
export function createWebhookApp(deps: { repos: Repos; scheduler: Scheduler }): Hono {
  const { repos, scheduler } = deps;
  const app = new Hono();

  app.post(
    '/h/:secret',
    bodyLimit({ maxSize: MAX_PAYLOAD_BYTES, onError: (c) => c.json({ error: 'Payload too large' }, 413) }),
    async (c) => {
      const routine = await repos.routines.findByWebhookSecret(c.req.param('secret'));
      if (!routine || !routine.enabled) return c.json({ error: 'Not found' }, 404);

      const text = await c.req.text();
      let payload: unknown;
      if (text.trim() !== '') {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = text;
        }
      }
      const result = await scheduler.runRoutineNow(routine.id, { payload });
      return result ? c.json(result, 202) : c.json({ error: 'Not found' }, 404);
    },
  );

  app.notFound((c) => c.json({ error: 'Not found' }, 404));
  return app;
}

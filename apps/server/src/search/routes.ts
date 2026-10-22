import type { Repos } from '@brot/db';
import { SearchQuery, type SearchHit } from '@brot/protocol';
import type { Hono } from 'hono';
import type { AppEnv } from '../auth';
import { buildSnippet } from './snippet';

export interface SearchRouteDeps {
  repos: Repos;
}

/** Mounts the read-only message search under `/api/*`, so device auth and CORS apply. */
export function mountSearchRoutes(app: Hono<AppEnv>, deps: SearchRouteDeps): void {
  const { repos } = deps;

  app.get('/api/search', async (c) => {
    const parsed = SearchQuery.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);
    }
    const query = parsed.data.q.trim();
    const botId = parsed.data.botId;
    const threadId = parsed.data.threadId;
    if (botId !== undefined && !(await repos.bots.get(botId))) {
      return c.json(
        { error: 'Invalid request', issues: [{ path: ['botId'], message: `unknown bot ${botId}` }] },
        400,
      );
    }
    if (threadId !== undefined && !(await repos.threads.get(threadId))) {
      return c.json(
        { error: 'Invalid request', issues: [{ path: ['threadId'], message: `unknown thread ${threadId}` }] },
        400,
      );
    }

    const rows = await repos.messages.search({
      query,
      ...(botId === undefined ? {} : { botId }),
      ...(threadId === undefined ? {} : { threadId }),
      ...(parsed.data.before === undefined ? {} : { before: parsed.data.before }),
      limit: parsed.data.limit,
    });
    const hits: SearchHit[] = rows.map((row) => {
      // The conversation's bot: a DM's bot or a room's lead. Fall back to the author when the thread bot is gone.
      const threadBotId = row.threadLeadBotId ?? row.threadBotId;
      const bot = row.threadBotName === undefined ? row.authorBotId : threadBotId;
      const botName = row.threadBotName ?? row.authorBotName;
      return {
        messageId: row.id,
        threadId: row.threadId,
        threadTitle: row.threadTitle,
        ...(bot === undefined ? {} : { botId: bot }),
        ...(botName === undefined ? {} : { botName }),
        role: row.role,
        snippet: buildSnippet(row.content, query),
        createdAt: row.createdAt,
      };
    });
    return c.json(hits);
  });
}

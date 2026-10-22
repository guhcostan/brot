import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SearchHit as SearchHitSchema, type Bot, type SearchHit, type Thread } from '@brot/protocol';
import { call, createTestContext, type TestContext } from '../testing';

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  await ctx.close();
});

async function createBot(name: string): Promise<Bot> {
  return ctx.services.repos.bots.create({ name, job: 'Operations' });
}

async function createThread(bot: Bot, title = 'Chat'): Promise<Thread> {
  return ctx.services.repos.threads.create(bot.id, { title });
}

async function addMessage(
  thread: Thread,
  role: 'user' | 'assistant' | 'system',
  content: string,
  createdAt: string,
  authorBotId?: string,
): Promise<string> {
  const message = await ctx.services.repos.messages.create({
    threadId: thread.id,
    role,
    content,
    ...(authorBotId === undefined ? {} : { authorBotId }),
  });
  await ctx.services.db.client.execute({
    sql: 'UPDATE messages SET created_at = ? WHERE id = ?',
    args: [createdAt, message.id],
  });
  return message.id;
}

async function search(query: string): Promise<SearchHit[]> {
  const res = await call(ctx.app, 'GET', `/api/search?${query}`);
  expect(res.status).toBe(200);
  const hits = (await res.json()) as SearchHit[];
  for (const hit of hits) expect(SearchHitSchema.parse(hit)).toEqual(hit);
  return hits;
}

describe('GET /api/search', () => {
  it('returns matched messages newest first with thread, bot and snippet context', async () => {
    const ada = await createBot('Ada');
    const planning = await createThread(ada, 'Planning');
    const first = await addMessage(planning, 'user', 'Please deploy the release today', '2026-10-20T10:00:00.000Z');
    const second = await addMessage(
      planning,
      'assistant',
      'The release is done.',
      '2026-10-20T11:00:00.000Z',
      ada.id,
    );
    await addMessage(planning, 'user', 'nothing to see here', '2026-10-20T12:00:00.000Z');

    const hits = await search('q=release');
    expect(hits.map((hit) => hit.messageId)).toEqual([second, first]);
    expect(hits[0]).toMatchObject({
      messageId: second,
      threadId: planning.id,
      threadTitle: 'Planning',
      botId: ada.id,
      botName: 'Ada',
      role: 'assistant',
      snippet: 'The release is done.',
      createdAt: '2026-10-20T11:00:00.000Z',
    });
    expect(hits[1]).toMatchObject({ role: 'user', botId: ada.id, botName: 'Ada' });

    expect((await search('q=RELEASE')).map((hit) => hit.messageId)).toEqual([second, first]);
    expect(await search('q=absent')).toEqual([]);
  });

  it('builds a centred, truncated snippet and never HTML-escapes it', async () => {
    const ada = await createBot('Ada');
    const thread = await createThread(ada, 'Long');
    await addMessage(thread, 'user', `${'x'.repeat(100)}NEEDLE${'y'.repeat(100)}`, '2026-10-20T10:00:00.000Z');
    const marked = await createThread(ada, 'Markup');
    await addMessage(marked, 'user', '<b>needle</b>', '2026-10-20T11:00:00.000Z');

    const [html, long] = await search('q=needle');
    expect(long?.snippet.startsWith('…')).toBe(true);
    expect(long?.snippet.endsWith('…')).toBe(true);
    expect(long?.snippet).toContain('NEEDLE');
    expect(long?.snippet.length).toBe(142);
    expect(html?.snippet).toBe('<b>needle</b>');
  });

  it('filters by bot, thread and before, and applies the limit', async () => {
    const ada = await createBot('Ada');
    const grace = await createBot('Grace');
    const adaChat = await createThread(ada, 'Ada chat');
    const graceChat = await createThread(grace, 'Grace chat');
    const roomThread = await ctx.services.repos.rooms.create({
      title: 'Team room',
      botIds: [ada.id, grace.id],
      leadBotId: ada.id,
    });
    const first = await addMessage(adaChat, 'user', 'needle in ada chat', '2026-10-20T10:00:00.000Z');
    const graceHit = await addMessage(graceChat, 'user', 'needle in grace chat', '2026-10-20T11:00:00.000Z');
    const roomHit = await addMessage(roomThread, 'assistant', 'needle in the room', '2026-10-20T12:00:00.000Z', grace.id);
    const second = await addMessage(adaChat, 'user', 'needle again', '2026-10-20T13:00:00.000Z');

    const adaHits = await search(`q=needle&botId=${ada.id}`);
    expect(adaHits.map((hit) => hit.messageId)).toEqual([second, roomHit, first]);
    // The room hit names the lead bot, not the message author.
    expect(adaHits.find((hit) => hit.messageId === roomHit)).toMatchObject({ botId: ada.id, botName: 'Ada' });

    expect((await search(`q=needle&botId=${grace.id}`)).map((hit) => hit.messageId)).toEqual([graceHit]);
    expect((await search(`q=needle&threadId=${adaChat.id}`)).map((hit) => hit.messageId)).toEqual([second, first]);
    expect((await search('q=needle&before=2026-10-20T12:00:00.000Z')).map((hit) => hit.messageId)).toEqual([
      graceHit,
      first,
    ]);
    expect((await search('q=needle&limit=2')).map((hit) => hit.messageId)).toEqual([second, roomHit]);
  });

  it('defaults to a limit of 20', async () => {
    const ada = await createBot('Ada');
    const thread = await createThread(ada, 'Many');
    for (let index = 0; index < 22; index += 1) {
      await addMessage(thread, 'user', `needle ${index}`, `2026-10-20T10:00:${String(index).padStart(2, '0')}.000Z`);
    }
    const hits = await search('q=needle');
    expect(hits).toHaveLength(20);
  });

  it('rejects a bad query, limit, before, bot or thread with 400 issues', async () => {
    async function issuesAt(path: string): Promise<{ path: string[] }[]> {
      const res = await call(ctx.app, 'GET', path);
      expect(res.status).toBe(400);
      return ((await res.json()) as { issues: { path: string[] }[] }).issues;
    }

    expect((await issuesAt('/api/search'))[0]?.path).toEqual(['q']);
    expect((await issuesAt('/api/search?q='))[0]?.path).toEqual(['q']);
    expect((await issuesAt('/api/search?q=%20%20'))[0]?.path).toEqual(['q']);
    expect((await issuesAt(`/api/search?q=${'x'.repeat(201)}`))[0]?.path).toEqual(['q']);
    expect((await issuesAt('/api/search?q=x&limit=0'))[0]?.path).toEqual(['limit']);
    expect((await issuesAt('/api/search?q=x&limit=51'))[0]?.path).toEqual(['limit']);
    expect((await issuesAt('/api/search?q=x&limit=abc'))[0]?.path).toEqual(['limit']);
    expect((await issuesAt('/api/search?q=x&before=yesterday'))[0]?.path).toEqual(['before']);
    expect((await issuesAt('/api/search?q=x&botId=nope'))[0]?.path).toEqual(['botId']);
    expect((await issuesAt('/api/search?q=x&threadId=nope'))[0]?.path).toEqual(['threadId']);
  });
});

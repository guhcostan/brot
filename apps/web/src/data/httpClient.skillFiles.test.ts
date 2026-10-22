import type { Skill } from '@brot/protocol';
import { describe, expect, it } from 'vitest';
import { createHttpClient, type FetchLike } from './httpClient';

const at = '2026-10-19T09:00:00.000Z';

const skill: Skill = {
  id: 'skill_1',
  name: 'Refund triage',
  description: 'Decide when a refund needs approval.',
  body: '# Steps\n\n1. Read the request.',
  version: 1,
  createdAt: at,
  updatedAt: at,
};

interface Call {
  method: string;
  path: string;
  headers: Headers;
  body: Record<string, unknown> | undefined;
}

function fakeFetch(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (input, init = {}) => {
    const path = new URL(input, 'http://brot.test').pathname;
    const call: Call = {
      method: init.method ?? 'GET',
      path,
      headers: new Headers(init.headers),
      body: typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined,
    };
    calls.push(call);
    return respond(call);
  };
  return { fetch, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('skill export', () => {
  it('downloads the text and keeps the server filename', async () => {
    const { fetch, calls } = fakeFetch(
      () =>
        new Response('# skill\n', {
          status: 200,
          headers: {
            'Content-Type': 'text/markdown; charset=utf-8',
            'Content-Disposition': 'attachment; filename="refund-triage.SKILL.md"',
          },
        }),
    );
    const client = createHttpClient({ fetch });

    await expect(client.exportSkill('skill_1')).resolves.toEqual({ content: '# skill\n', filename: 'refund-triage.SKILL.md' });
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/api/skills/skill_1/export' });
    expect(calls[0]?.headers.get('Accept')).toBe('text/markdown');
  });

  it('falls back to a slug from the id when the header is missing', async () => {
    const { fetch } = fakeFetch(() => new Response('# skill\n', { status: 200 }));
    const client = createHttpClient({ fetch });

    await expect(client.exportSkill('skill_refund_triage')).resolves.toMatchObject({ filename: 'refund-triage.SKILL.md' });
  });

  it('surfaces a 404', async () => {
    const client = createHttpClient({ fetch: fakeFetch(() => json({ error: 'Skill not found' }, 404)).fetch });

    await expect(client.exportSkill('nope')).rejects.toThrow('404 Skill not found');
  });
});

describe('skill import', () => {
  it('posts the file for this bot and without botId for a shared skill', async () => {
    const { fetch, calls } = fakeFetch(() => json(skill, 201));
    const client = createHttpClient({ fetch });

    await expect(client.importSkill({ content: '---\nname: Refund triage\n---\n', botId: 'bot_1' })).resolves.toEqual(skill);
    await client.importSkill({ content: '---\nname: Refund triage\n---\n' });

    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/skills/import' });
    expect(calls[0]?.body).toEqual({ content: '---\nname: Refund triage\n---\n', botId: 'bot_1' });
    expect(calls[1]?.body).toEqual({ content: '---\nname: Refund triage\n---\n' });
  });

  it('rejects an empty file before any request and surfaces 400 issues', async () => {
    const { fetch, calls } = fakeFetch(() => json(skill, 201));
    const client = createHttpClient({ fetch });

    await expect(client.importSkill({ content: '   ' })).rejects.toThrow();
    expect(calls).toHaveLength(0);

    const refused = createHttpClient({
      fetch: fakeFetch(() => json({ error: 'Invalid request', issues: [{ path: ['content'], message: 'expected a SKILL.md' }] }, 400)).fetch,
    });
    await expect(refused.importSkill({ content: 'nope' })).rejects.toThrow('400 Invalid request: expected a SKILL.md');
  });

  it('rejects a malformed skill response', async () => {
    const client = createHttpClient({ fetch: fakeFetch(() => json({ id: 'skill_1' }, 201)).fetch });

    await expect(client.importSkill({ content: 'x' })).rejects.toThrow();
  });
});

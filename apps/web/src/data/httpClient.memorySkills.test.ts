import type { Memory, Skill } from '@brot/protocol';
import { describe, expect, it } from 'vitest';
import { createHttpClient, type FetchLike } from './httpClient';

const at = '2026-10-19T09:00:00.000Z';

const memory: Memory = {
  id: 'mem_1',
  botId: 'bot_1',
  kind: 'preference',
  content: 'Prefers short summaries before 10am.',
  createdAt: at,
  updatedAt: at,
};

const skill: Skill = {
  id: 'skill_1',
  botId: 'bot_1',
  name: 'Refund triage',
  description: 'Decide when a refund needs approval.',
  body: '# Refund triage\n\n- Check the order.',
  version: 1,
  createdAt: at,
  updatedAt: at,
};

const sharedSkill: Skill = {
  id: 'skill_shared',
  name: 'Weekly plan',
  description: 'Turn the board into a weekly plan.',
  body: '# Weekly plan',
  version: 3,
  createdAt: at,
  updatedAt: at,
};

interface Call {
  method: string;
  path: string;
  search: string;
  body: unknown;
}

function fakeFetch(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (input, init = {}) => {
    const url = new URL(input, 'http://brot.test');
    const call: Call = {
      method: init.method ?? 'GET',
      path: url.pathname,
      search: url.search,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return respond(call);
  };
  return { fetch, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('memory routes', () => {
  it('lists and creates memories for one bot', async () => {
    const { fetch, calls } = fakeFetch((call) => (call.method === 'POST' ? json(memory, 201) : json([memory])));
    const client = createHttpClient({ fetch });

    await expect(client.listMemories('bot_1')).resolves.toEqual([memory]);
    await expect(client.createMemory('bot_1', { kind: 'preference', content: memory.content })).resolves.toEqual(memory);

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(['GET /api/bots/bot_1/memories', 'POST /api/bots/bot_1/memories']);
    expect(calls[1]?.body).toEqual({ kind: 'preference', content: memory.content });
  });

  it('updates a memory with PATCH and deletes it with DELETE', async () => {
    const updated = { ...memory, content: 'Prefers numbered lists.', updatedAt: at };
    const { fetch, calls } = fakeFetch((call) => (call.method === 'PATCH' ? json(updated) : new Response(null, { status: 204 })));
    const client = createHttpClient({ fetch });

    await expect(client.updateMemory('mem_1', { content: updated.content })).resolves.toEqual(updated);
    await expect(client.deleteMemory('mem_1')).resolves.toBeUndefined();

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(['PATCH /api/memories/mem_1', 'DELETE /api/memories/mem_1']);
    expect(calls[0]?.body).toEqual({ content: updated.content });
  });

  it('rejects an invalid memory kind before any request, and surfaces a 400 issue', async () => {
    const { fetch, calls } = fakeFetch(() =>
      json({ error: 'Invalid request', issues: [{ path: ['kind'], message: 'Invalid enum value' }] }, 400),
    );
    const client = createHttpClient({ fetch });

    await expect(client.createMemory('bot_1', { kind: 'nope' as Memory['kind'], content: 'x' })).rejects.toThrow();
    expect(calls).toHaveLength(0);

    await expect(client.createMemory('bot_1', { kind: 'fact', content: 'x' })).rejects.toThrow(
      '400 Invalid request: Invalid enum value',
    );
  });

  it('surfaces the 404 of an unknown memory', async () => {
    const { fetch } = fakeFetch(() => json({ error: 'Memory not found' }, 404));
    const client = createHttpClient({ fetch });

    await expect(client.updateMemory('nope', { content: 'x' })).rejects.toThrow('404 Memory not found');
    await expect(client.deleteMemory('nope')).rejects.toThrow('404 Memory not found');
  });

  it('rejects a memory list that does not match the protocol', async () => {
    const { fetch } = fakeFetch(() => json([{ id: 'mem_1' }]));
    const client = createHttpClient({ fetch });

    await expect(client.listMemories('bot_1')).rejects.toThrow();
  });
});

describe('skill routes', () => {
  it('lists every skill, or one bot skills plus the shared ones', async () => {
    const { fetch, calls } = fakeFetch(() => json([skill, sharedSkill]));
    const client = createHttpClient({ fetch });

    await expect(client.listSkills()).resolves.toEqual([skill, sharedSkill]);
    await client.listSkills('bot_1');

    expect(calls.map((call) => `${call.path}${call.search}`)).toEqual(['/api/skills', '/api/skills?botId=bot_1']);
  });

  it('creates a bot skill and a shared one', async () => {
    const { fetch, calls } = fakeFetch((call) => json(call.body !== null && 'botId' in (call.body as object) ? skill : sharedSkill, 201));
    const client = createHttpClient({ fetch });

    await client.createSkill({ name: skill.name, description: skill.description, body: skill.body, botId: 'bot_1' });
    await client.createSkill({ name: sharedSkill.name, description: sharedSkill.description, body: sharedSkill.body });

    expect(calls.map((call) => call.body)).toEqual([
      { name: skill.name, description: skill.description, body: skill.body, botId: 'bot_1' },
      { name: sharedSkill.name, description: sharedSkill.description, body: sharedSkill.body },
    ]);
  });

  it('rejects a nameless skill before any request', async () => {
    const { fetch, calls } = fakeFetch(() => json(skill, 201));
    const client = createHttpClient({ fetch });

    await expect(client.createSkill({ name: '', description: '', body: '' })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('updates a skill with PATCH and deletes it with DELETE', async () => {
    const updated = { ...skill, name: 'Refund handling', version: 2 };
    const { fetch, calls } = fakeFetch((call) => (call.method === 'PATCH' ? json(updated) : new Response(null, { status: 204 })));
    const client = createHttpClient({ fetch });

    await expect(client.updateSkill('skill_1', { name: 'Refund handling' })).resolves.toEqual(updated);
    await expect(client.deleteSkill('skill_1')).resolves.toBeUndefined();

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(['PATCH /api/skills/skill_1', 'DELETE /api/skills/skill_1']);
    expect(calls[0]?.body).toEqual({ name: 'Refund handling' });
  });

  it('surfaces the 404 of an unknown skill and the 400 of a rejected body', async () => {
    const { fetch } = fakeFetch((call) =>
      call.method === 'POST' ? json({ error: 'Invalid request', issues: [{ message: 'expected a string' }] }, 400) : json({ error: 'Skill not found' }, 404),
    );
    const client = createHttpClient({ fetch });

    await expect(client.updateSkill('nope', { body: 'x' })).rejects.toThrow('404 Skill not found');
    await expect(client.deleteSkill('nope')).rejects.toThrow('404 Skill not found');
    await expect(client.createSkill({ name: 'x', description: '', body: '' })).rejects.toThrow('400 Invalid request: expected a string');
  });

  it('rejects a skill list that does not match the protocol', async () => {
    const { fetch } = fakeFetch(() => json([{ id: 'skill_1' }]));
    const client = createHttpClient({ fetch });

    await expect(client.listSkills()).rejects.toThrow();
  });
});

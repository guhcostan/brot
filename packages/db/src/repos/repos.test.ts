import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CanonicalEvent } from '@brot/protocol';
import { createDb, migrate, type BrotDb } from '../index';
import { createRepos, type Repos } from './index';

let handle: BrotDb;
let repos: Repos;

beforeEach(async () => {
  handle = await createDb(':memory:');
  await migrate(handle.db);
  repos = createRepos(handle.db);
});

afterEach(() => {
  handle.client.close();
});

async function seed() {
  const bot = await repos.bots.create({ name: 'Ada', job: 'Researcher' });
  const thread = await repos.threads.create(bot.id, { title: 'Chat' });
  const run = await repos.runs.create({ threadId: thread.id, botId: bot.id, engine: 'mock' });
  return { bot, thread, run };
}

describe('bots', () => {
  it('applies CreateBot defaults', async () => {
    const bot = await repos.bots.create({ name: 'Ada', job: 'Researcher' });
    expect(bot).toMatchObject({
      name: 'Ada',
      job: 'Researcher',
      instructions: '',
      engine: 'mock',
      computer: 'sandbox',
      egress: { mode: 'deny', allow: [] },
      pinned: false,
      archived: false,
    });
    expect(bot.avatar).toBeUndefined();
    expect(bot.model).toBeUndefined();
    expect(await repos.bots.get(bot.id)).toEqual(bot);
  });

  it('stores an egress allowlist and reads it back', async () => {
    const bot = await repos.bots.create({
      name: 'Ada',
      job: 'x',
      egress: { mode: 'allowlist', allow: ['api.github.com', '*.example.com'] },
    });
    expect(bot.egress).toEqual({ mode: 'allowlist', allow: ['api.github.com', '*.example.com'] });
    expect((await repos.bots.get(bot.id))?.egress).toEqual(bot.egress);

    const updated = await repos.bots.update(bot.id, { egress: { mode: 'deny', allow: [] } });
    expect(updated?.egress).toEqual({ mode: 'deny', allow: [] });
  });

  it('stores the notification toggle and leaves it unset when true', async () => {
    const on = await repos.bots.create({ name: 'Ada', job: 'x' });
    expect(on.notifications).toBeUndefined();
    const off = await repos.bots.create({ name: 'Bo', job: 'x', notifications: false });
    expect(off.notifications).toBe(false);
    expect((await repos.bots.get(off.id))?.notifications).toBe(false);
    expect((await repos.bots.update(off.id, { notifications: true }))?.notifications).toBeUndefined();
  });

  it('stores the run and daily budget caps and leaves them unset when absent', async () => {
    const plain = await repos.bots.create({ name: 'Ada', job: 'x' });
    expect(plain.runBudgetUsd).toBeUndefined();
    expect(plain.dailyBudgetUsd).toBeUndefined();

    const budgeted = await repos.bots.create({ name: 'Bo', job: 'x', runBudgetUsd: 0.5, dailyBudgetUsd: 5 });
    expect(budgeted).toMatchObject({ runBudgetUsd: 0.5, dailyBudgetUsd: 5 });
    expect((await repos.bots.get(budgeted.id))?.dailyBudgetUsd).toBe(5);
    expect((await repos.bots.list()).find((bot) => bot.id === budgeted.id)?.runBudgetUsd).toBe(0.5);

    expect((await repos.bots.update(budgeted.id, { runBudgetUsd: 0 }))?.runBudgetUsd).toBe(0);
    expect((await repos.bots.update(budgeted.id, { runBudgetUsd: null }))?.runBudgetUsd).toBeUndefined();
    expect((await repos.bots.update(budgeted.id, { dailyBudgetUsd: null }))?.dailyBudgetUsd).toBeUndefined();
  });

  it('stores the fallback chain, keeps its order, and clears it', async () => {
    const plain = await repos.bots.create({ name: 'Ada', job: 'x' });
    expect(plain).not.toHaveProperty('fallbackModels');

    const fallback = await repos.bots.create({
      name: 'Bo',
      job: 'x',
      fallbackModels: ['fake/model-2', 'fake/model-3'],
    });
    expect(fallback.fallbackModels).toEqual(['fake/model-2', 'fake/model-3']);
    expect((await repos.bots.get(fallback.id))?.fallbackModels).toEqual(['fake/model-2', 'fake/model-3']);
    expect((await repos.bots.list()).find((bot) => bot.id === fallback.id)?.fallbackModels).toEqual([
      'fake/model-2',
      'fake/model-3',
    ]);

    expect((await repos.bots.update(fallback.id, { fallbackModels: ['fake/model-4'] }))?.fallbackModels).toEqual([
      'fake/model-4',
    ]);
    expect((await repos.bots.update(fallback.id, { fallbackModels: null }))?.fallbackModels).toBeUndefined();
    expect((await repos.bots.update(fallback.id, { fallbackModels: [] }))?.fallbackModels).toBeUndefined();
  });

  it('stores the approval mode and leaves it unset for ask', async () => {
    const asking = await repos.bots.create({ name: 'Ada', job: 'x' });
    expect(asking.approvalMode).toBeUndefined();
    const editing = await repos.bots.create({ name: 'Bo', job: 'x', approvalMode: 'edits' });
    expect(editing.approvalMode).toBe('edits');
    expect((await repos.bots.get(editing.id))?.approvalMode).toBe('edits');
    expect((await repos.bots.list()).find((bot) => bot.id === editing.id)?.approvalMode).toBe('edits');
    expect((await repos.bots.update(editing.id, { approvalMode: 'ask' }))?.approvalMode).toBeUndefined();
    expect((await repos.bots.update(asking.id, { approvalMode: 'edits' }))?.approvalMode).toBe('edits');
  });

  it('stores the spoken-replies toggle and leaves it unset when false', async () => {
    const plain = await repos.bots.create({ name: 'Ada', job: 'x' });
    expect(plain.speakReplies).toBeUndefined();
    const spoken = await repos.bots.create({ name: 'Bo', job: 'x', speakReplies: true });
    expect(spoken.speakReplies).toBe(true);
    expect((await repos.bots.get(spoken.id))?.speakReplies).toBe(true);

    expect((await repos.bots.update(spoken.id, { speakReplies: false }))?.speakReplies).toBeUndefined();
    expect((await repos.bots.update(plain.id, { speakReplies: true }))?.speakReplies).toBe(true);
  });

  it('stores the MCP server grant and drops ids of servers that no longer exist', async () => {
    const first = await repos.mcpServers.create({ name: 'first', command: 'node' });
    const second = await repos.mcpServers.create({ name: 'second', command: 'node' });

    const all = await repos.bots.create({ name: 'Ada', job: 'x' });
    expect(all.mcpServerIds).toBeUndefined();

    const granted = await repos.bots.create({ name: 'Bo', job: 'x', mcpServerIds: [first.id, second.id] });
    expect(granted.mcpServerIds).toEqual([first.id, second.id]);
    expect((await repos.bots.get(granted.id))?.mcpServerIds).toEqual([first.id, second.id]);

    const none = await repos.bots.update(granted.id, { mcpServerIds: [] });
    expect(none?.mcpServerIds).toEqual([]);
    expect((await repos.bots.update(granted.id, { mcpServerIds: [first.id] }))?.mcpServerIds).toEqual([first.id]);
    expect((await repos.bots.update(granted.id, { mcpServerIds: null }))?.mcpServerIds).toBeUndefined();

    const stale = await repos.bots.create({ name: 'Cy', job: 'x', mcpServerIds: [first.id, second.id] });
    expect(await repos.mcpServers.remove(second.id)).toBe(true);
    expect((await repos.bots.get(stale.id))?.mcpServerIds).toEqual([first.id]);
    expect((await repos.bots.list()).find((bot) => bot.id === stale.id)?.mcpServerIds).toEqual([first.id]);

    expect(await repos.mcpServers.remove(first.id)).toBe(true);
    expect((await repos.bots.get(stale.id))?.mcpServerIds).toEqual([]);
  });

  it('stores a host browser flag and leaves it unset when false', async () => {
    const plain = await repos.bots.create({ name: 'Ada', job: 'x' });
    expect(plain.browser).toBeUndefined();

    const browsing = await repos.bots.create({ name: 'Bo', job: 'x', browser: true });
    expect(browsing.browser).toBe(true);
    expect((await repos.bots.get(browsing.id))?.browser).toBe(true);
    expect((await repos.bots.list()).find((bot) => bot.id === browsing.id)?.browser).toBe(true);

    expect((await repos.bots.update(browsing.id, { browser: false }))?.browser).toBeUndefined();
    expect((await repos.bots.update(plain.id, { browser: true }))?.browser).toBe(true);
  });

  it('stores the shared browser profile and clears it back to its own', async () => {
    const profile = await repos.browserProfiles.create({ name: 'Shared accounts' });
    const bot = await repos.bots.create({ name: 'Ada', job: 'x', browser: true, browserProfileId: profile.id });
    expect(bot.browserProfileId).toBe(profile.id);
    expect((await repos.bots.get(bot.id))?.browserProfileId).toBe(profile.id);
    expect((await repos.bots.list()).find((item) => item.id === bot.id)?.browserProfileId).toBe(profile.id);

    expect((await repos.bots.update(bot.id, { browserProfileId: null }))?.browserProfileId).toBeUndefined();
    expect((await repos.bots.update(bot.id, { browserProfileId: profile.id }))?.browserProfileId).toBe(profile.id);

    const plain = await repos.bots.create({ name: 'Bo', job: 'x' });
    expect(plain.browserProfileId).toBeUndefined();
  });

  it('rejects invalid egress hosts on create and update', async () => {
    await expect(
      repos.bots.create({ name: 'Ada', job: 'x', egress: { mode: 'allowlist', allow: ['https://github.com'] } }),
    ).rejects.toThrow();
    const bot = await repos.bots.create({ name: 'Ada', job: 'x' });
    await expect(repos.bots.update(bot.id, { egress: { mode: 'deny', allow: ['github.com'] } })).rejects.toThrow();
  });

  it('requires hostAcknowledged to run on the host, and does not store the acknowledgement', async () => {
    await expect(repos.bots.create({ name: 'Ada', job: 'x', computer: 'host' })).rejects.toThrow(/hostAcknowledged/);

    const bot = await repos.bots.create({ name: 'Ada', job: 'x', computer: 'host', hostAcknowledged: true });
    expect(bot.computer).toBe('host');
    expect(bot).not.toHaveProperty('hostAcknowledged');

    const bare = await repos.bots.create({ name: 'Grace', job: 'x' });
    await expect(repos.bots.update(bare.id, { computer: 'host' })).rejects.toThrow(/hostAcknowledged/);
    const moved = await repos.bots.update(bare.id, { computer: 'host', hostAcknowledged: true });
    expect(moved).toMatchObject({ computer: 'host' });
    expect(moved).not.toHaveProperty('hostAcknowledged');
  });

  it('rejects invalid input', async () => {
    await expect(repos.bots.create({ name: '', job: 'x' })).rejects.toThrow();
  });

  it('lists active bots unless archived ones are requested', async () => {
    const active = await repos.bots.create({ name: 'Active', job: 'x' });
    const archived = await repos.bots.create({ name: 'Old', job: 'x' });
    await repos.bots.update(archived.id, { archived: true });

    expect((await repos.bots.list()).map((b) => b.id)).toEqual([active.id]);
    expect((await repos.bots.list({ includeArchived: true })).map((b) => b.id).sort()).toEqual(
      [active.id, archived.id].sort(),
    );
  });

  it('updates fields and bumps updatedAt', async () => {
    const bot = await repos.bots.create({ name: 'Ada', job: 'Researcher' });
    const updated = await repos.bots.update(bot.id, { name: 'Grace', pinned: true, computer: 'sandbox' });
    expect(updated).toMatchObject({ name: 'Grace', pinned: true, computer: 'sandbox', job: 'Researcher' });
    expect((updated?.updatedAt ?? '') >= bot.updatedAt).toBe(true);
    expect(await repos.bots.update('missing', { name: 'x' })).toBeUndefined();
  });

  it('removes a bot and reports missing ids', async () => {
    const bot = await repos.bots.create({ name: 'Ada', job: 'x' });
    expect(await repos.bots.remove(bot.id)).toBe(true);
    expect(await repos.bots.remove(bot.id)).toBe(false);
    expect(await repos.bots.get(bot.id)).toBeUndefined();
  });
});

describe('browser profiles', () => {
  it('creates, lists by name, renames and removes profiles', async () => {
    const shared = await repos.browserProfiles.create({ name: '  Shared accounts  ' });
    expect(shared.name).toBe('Shared accounts');
    const work = await repos.browserProfiles.create({ name: 'Work' });
    expect((await repos.browserProfiles.list()).map((profile) => profile.name)).toEqual(['Shared accounts', 'Work']);
    expect(await repos.browserProfiles.get(shared.id)).toEqual(shared);

    const renamed = await repos.browserProfiles.update(shared.id, { name: 'Team logins' });
    expect(renamed).toMatchObject({ name: 'Team logins' });
    expect((renamed?.updatedAt ?? '') >= shared.updatedAt).toBe(true);
    expect(await repos.browserProfiles.update('missing', { name: 'x' })).toBeUndefined();

    expect(await repos.browserProfiles.remove(work.id)).toBe(true);
    expect(await repos.browserProfiles.remove(work.id)).toBe(false);
    expect(await repos.browserProfiles.get(work.id)).toBeUndefined();
  });

  it('rejects an empty, long or multi-line name', async () => {
    await expect(repos.browserProfiles.create({ name: '   ' })).rejects.toThrow();
    await expect(repos.browserProfiles.create({ name: 'x'.repeat(61) })).rejects.toThrow();
    await expect(repos.browserProfiles.create({ name: 'two\nlines' })).rejects.toThrow();
  });

  it('ungroups its bots when removed and never deletes them', async () => {
    const profile = await repos.browserProfiles.create({ name: 'Shared accounts' });
    const first = await repos.bots.create({ name: 'Ada', job: 'x', browser: true, browserProfileId: profile.id });
    const second = await repos.bots.create({ name: 'Bo', job: 'x', browser: true, browserProfileId: profile.id });

    expect(await repos.browserProfiles.remove(profile.id)).toBe(true);
    expect((await repos.bots.get(first.id))?.browser).toBe(true);
    expect((await repos.bots.get(first.id))?.browserProfileId).toBeUndefined();
    expect((await repos.bots.get(second.id))?.browserProfileId).toBeUndefined();
  });
});

describe('saved logins', () => {
  const secretNames = (id: string) => ({
    username: `login.${id}.username`,
    password: `login.${id}.password`,
    totp: `login.${id}.totp`,
  });
  const input = (overrides: Record<string, unknown> = {}) => ({
    name: 'GitHub work',
    host: 'github.com',
    username: 'ada@example.com',
    password: 'correct horse battery staple',
    ...overrides,
  });

  it('creates, lists by name, gets by id and name, and updates', async () => {
    const first = await repos.savedLogins.create(input(), { id: 'login_1', secretNames: secretNames('login_1') });
    expect(first).toMatchObject({ id: 'login_1', name: 'GitHub work', host: 'github.com', hasTotp: false });
    expect(first.label).toBeUndefined();

    const second = await repos.savedLogins.create(
      input({ name: 'Bank', host: 'bank.example', label: 'Savings', totp: 'JBSWY3DPEHPK3PXP' }),
      { id: 'login_2', secretNames: secretNames('login_2') },
    );
    expect(second).toMatchObject({ name: 'Bank', label: 'Savings', hasTotp: true });

    expect((await repos.savedLogins.list()).map((login) => login.name)).toEqual(['Bank', 'GitHub work']);
    expect(await repos.savedLogins.get('login_1')).toEqual(first);
    expect(await repos.savedLogins.getByName('GitHub work')).toEqual(first);
    expect(await repos.savedLogins.getByName('missing')).toBeUndefined();

    const updated = await repos.savedLogins.update('login_2', { name: 'Bank work', label: null, totp: null }, secretNames('login_2'));
    expect(updated).toMatchObject({ name: 'Bank work', hasTotp: false });
    expect(updated?.label).toBeUndefined();
    expect((updated?.updatedAt ?? '') >= second.updatedAt).toBe(true);
    expect(await repos.savedLogins.update('missing', { name: 'x' }, secretNames('missing'))).toBeUndefined();
  });

  it('stores only vault secret names, never values', async () => {
    await repos.savedLogins.create(input({ totp: 'JBSWY3DPEHPK3PXP' }), { id: 'login_1', secretNames: secretNames('login_1') });
    const row = await handle.client.execute(
      "SELECT username_secret, password_secret, totp_secret FROM saved_logins WHERE id = 'login_1'",
    );
    expect(row.rows[0]).toEqual({
      username_secret: 'login.login_1.username',
      password_secret: 'login.login_1.password',
      totp_secret: 'login.login_1.totp',
    });
    const raw = JSON.stringify(row.rows[0]);
    expect(raw).not.toContain('ada@example.com');
    expect(raw).not.toContain('correct horse');
    expect(raw).not.toContain('JBSWY3DPEHPK3PXP');
  });

  it('keeps names unique and removes a login', async () => {
    const created = await repos.savedLogins.create(input(), { id: 'login_1', secretNames: secretNames('login_1') });
    await expect(
      repos.savedLogins.create(input(), { id: 'login_2', secretNames: secretNames('login_2') }),
    ).rejects.toThrow();
    expect(await repos.savedLogins.remove(created.id)).toBe(true);
    expect(await repos.savedLogins.remove(created.id)).toBe(false);
    expect(await repos.savedLogins.get(created.id)).toBeUndefined();
  });
});

describe('teams', () => {
  it('creates, lists, updates and removes teams', async () => {
    const growth = await repos.teams.create({ name: 'Growth', instructions: 'Ship one experiment a week.' });
    expect(growth).toMatchObject({ name: 'Growth', instructions: 'Ship one experiment a week.' });
    expect(growth.chiefBotId).toBeUndefined();

    const ada = await repos.bots.create({ name: 'Ada', job: 'x' });
    const ops = await repos.teams.create({ name: 'Ops', chiefBotId: ada.id });
    expect(ops.chiefBotId).toBe(ada.id);
    expect(ops.instructions).toBe('');
    expect((await repos.teams.list()).map((team) => team.name)).toEqual(['Growth', 'Ops']);
    expect(await repos.teams.get(ops.id)).toEqual(ops);

    const updated = await repos.teams.update(ops.id, {
      name: 'Operations',
      instructions: 'Keep it running.',
      chiefBotId: null,
    });
    expect(updated).toMatchObject({ name: 'Operations', instructions: 'Keep it running.' });
    expect(updated?.chiefBotId).toBeUndefined();
    expect((updated?.updatedAt ?? '') >= ops.updatedAt).toBe(true);
    expect(await repos.teams.update('missing', { name: 'x' })).toBeUndefined();

    expect(await repos.teams.remove(ops.id)).toBe(true);
    expect(await repos.teams.remove(ops.id)).toBe(false);
    expect(await repos.teams.get(ops.id)).toBeUndefined();
  });

  it('stores a bot team, and a new bot has none', async () => {
    const team = await repos.teams.create({ name: 'Growth' });
    const grouped = await repos.bots.create({ name: 'Ada', job: 'x', teamId: team.id });
    expect(grouped.teamId).toBe(team.id);
    expect((await repos.bots.get(grouped.id))?.teamId).toBe(team.id);
    expect((await repos.bots.list()).find((bot) => bot.id === grouped.id)?.teamId).toBe(team.id);

    expect((await repos.bots.update(grouped.id, { teamId: null }))?.teamId).toBeUndefined();
    expect((await repos.bots.update(grouped.id, { teamId: team.id }))?.teamId).toBe(team.id);
    expect((await repos.bots.create({ name: 'Grace', job: 'x' })).teamId).toBeUndefined();
  });

  it('ungroups its bots when a team is deleted, and never deletes them', async () => {
    const team = await repos.teams.create({ name: 'Growth' });
    const grouped = await repos.bots.create({ name: 'Ada', job: 'x', teamId: team.id });
    const other = await repos.bots.create({ name: 'Grace', job: 'x' });

    expect(await repos.teams.remove(team.id)).toBe(true);

    expect(await repos.bots.get(grouped.id)).toMatchObject({ id: grouped.id, name: 'Ada' });
    expect((await repos.bots.get(grouped.id))?.teamId).toBeUndefined();
    expect((await repos.bots.get(other.id))?.teamId).toBeUndefined();
  });

  it('clears the chief when the chief bot is deleted', async () => {
    const chief = await repos.bots.create({ name: 'Ada', job: 'x' });
    const team = await repos.teams.create({ name: 'Growth', chiefBotId: chief.id });

    await repos.bots.remove(chief.id);

    expect((await repos.teams.get(team.id))?.chiefBotId).toBeUndefined();
  });
});

describe('threads', () => {
  it('creates threads with a default title and lists them per bot', async () => {
    const bot = await repos.bots.create({ name: 'Ada', job: 'x' });
    const other = await repos.bots.create({ name: 'Grace', job: 'x' });
    const named = await repos.threads.create(bot.id, { title: 'Plan' });
    const untitled = await repos.threads.create(bot.id);
    await repos.threads.create(other.id);

    expect(named.title).toBe('Plan');
    expect(untitled.title).toBe('New thread');
    expect((await repos.threads.listByBot(bot.id)).map((t) => t.id).sort()).toEqual(
      [named.id, untitled.id].sort(),
    );
  });

  it('stores a thread model override, updates it, and clears it with null', async () => {
    const bot = await repos.bots.create({ name: 'Ada', job: 'x' });
    const plain = await repos.threads.create(bot.id);
    expect(plain).not.toHaveProperty('model');

    const overridden = await repos.threads.create(bot.id, { title: 'Fast lane', model: 'fake/model-2' });
    expect(overridden).toMatchObject({ title: 'Fast lane', model: 'fake/model-2' });
    expect((await repos.threads.get(overridden.id))?.model).toBe('fake/model-2');
    expect((await repos.threads.listByBot(bot.id)).find((thread) => thread.id === overridden.id)?.model).toBe(
      'fake/model-2',
    );

    const renamed = await repos.threads.update(overridden.id, { title: 'Faster lane' });
    expect(renamed).toMatchObject({ title: 'Faster lane', model: 'fake/model-2' });
    expect((renamed?.updatedAt ?? '') >= overridden.updatedAt).toBe(true);

    expect((await repos.threads.update(overridden.id, { model: 'fake/model-3' }))?.model).toBe('fake/model-3');
    expect((await repos.threads.update(overridden.id, { model: null }))?.model).toBeUndefined();
    expect((await repos.threads.get(overridden.id))?.model).toBeUndefined();
    expect(await repos.threads.update('missing', { model: 'fake/model-2' })).toBeUndefined();
  });

  it('renames a thread and bumps updatedAt', async () => {
    const { thread } = await seed();
    const renamed = await repos.threads.setTitle(thread.id, 'Launch plan');
    expect(renamed).toMatchObject({ id: thread.id, title: 'Launch plan' });
    expect((renamed?.updatedAt ?? '') >= thread.updatedAt).toBe(true);
    expect(await repos.threads.setTitle('missing', 'x')).toBeUndefined();
  });

  it('touch bumps updatedAt', async () => {
    const { thread } = await seed();
    const touched = await repos.threads.touch(thread.id);
    expect((touched?.updatedAt ?? '') >= thread.updatedAt).toBe(true);
    expect(touched?.title).toBe(thread.title);
    expect(await repos.threads.touch('missing')).toBeUndefined();
  });
});

describe('run cost since', () => {
  it('sums only the bot\'s runs started at or after the given instant', async () => {
    const bot = await repos.bots.create({ name: 'Ada', job: 'x' });
    const other = await repos.bots.create({ name: 'Bo', job: 'x' });
    const thread = await repos.threads.create(bot.id);
    const otherThread = await repos.threads.create(other.id);
    const today = new Date();
    const dayStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const yesterday = new Date(dayStart.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const earlyToday = await repos.runs.create({ threadId: thread.id, botId: bot.id, engine: 'mock' });
    await repos.runs.update(earlyToday.id, { costUsd: 0.25 });
    const laterToday = await repos.runs.create({ threadId: thread.id, botId: bot.id, engine: 'mock' });
    await repos.runs.update(laterToday.id, { costUsd: 0.5 });
    const yesterdayRun = await repos.runs.create({ threadId: thread.id, botId: bot.id, engine: 'mock' });
    await repos.runs.update(yesterdayRun.id, { costUsd: 9 });
    const otherBotRun = await repos.runs.create({ threadId: otherThread.id, botId: other.id, engine: 'mock' });
    await repos.runs.update(otherBotRun.id, { costUsd: 7 });
    for (const [id, startedAt] of [
      [earlyToday.id, new Date(dayStart.getTime() + 1000).toISOString()],
      [laterToday.id, new Date(dayStart.getTime() + 2000).toISOString()],
      [yesterdayRun.id, yesterday],
      [otherBotRun.id, new Date(dayStart.getTime() + 3000).toISOString()],
    ] as const) {
      await handle.client.execute({ sql: 'UPDATE runs SET started_at = ? WHERE id = ?', args: [startedAt, id] });
    }

    expect(await repos.runs.costSince(bot.id, dayStart.toISOString())).toBeCloseTo(0.75, 10);
    expect(await repos.runs.costSince(bot.id, new Date(dayStart.getTime() + 1500).toISOString())).toBeCloseTo(0.5, 10);
    expect(await repos.runs.costSince(other.id, dayStart.toISOString())).toBeCloseTo(7, 10);
    expect(await repos.runs.costSince(bot.id, new Date(dayStart.getTime() + 86_400_000).toISOString())).toBe(0);
  });
});

describe('messages', () => {
  it('stores messages in order and honours a pre-assigned id', async () => {
    const { thread } = await seed();
    const first = await repos.messages.create({ threadId: thread.id, role: 'user', content: 'hi', id: 'msg-1' });
    const second = await repos.messages.create({ threadId: thread.id, role: 'assistant', content: 'hello' });

    expect(first.id).toBe('msg-1');
    expect((await repos.messages.listByThread(thread.id)).map((m) => m.content)).toEqual(['hi', 'hello']);
    expect(second.role).toBe('assistant');
  });

  it('rejects an unknown role', async () => {
    const { thread } = await seed();
    await expect(
      repos.messages.create({ threadId: thread.id, role: 'robot' as 'user', content: 'x' }),
    ).rejects.toThrow();
  });
});

describe('message search', () => {
  async function seedBotsAndThreads() {
    const ada = await repos.bots.create({ name: 'Ada', job: 'Lead' });
    const grace = await repos.bots.create({ name: 'Grace', job: 'Ops' });
    const adaChat = await repos.threads.create(ada.id, { title: 'Ada chat' });
    const graceChat = await repos.threads.create(grace.id, { title: 'Grace chat' });
    const room = await repos.rooms.create({ title: 'Team room', botIds: [ada.id, grace.id], leadBotId: ada.id });
    return { ada, grace, adaChat, graceChat, room };
  }

  async function addMessage(
    threadId: string,
    role: 'user' | 'assistant' | 'system',
    content: string,
    createdAt: string,
    authorBotId?: string,
  ): Promise<string> {
    const message = await repos.messages.create({
      threadId,
      role,
      content,
      ...(authorBotId === undefined ? {} : { authorBotId }),
    });
    await handle.client.execute({ sql: 'UPDATE messages SET created_at = ? WHERE id = ?', args: [createdAt, message.id] });
    return message.id;
  }

  it('matches content case-insensitively, newest first, with the thread and author context', async () => {
    const { ada, adaChat, room } = await seedBotsAndThreads();
    const first = await addMessage(adaChat.id, 'user', 'Please deploy the Release', '2026-10-20T10:00:00.000Z');
    const second = await addMessage(
      adaChat.id,
      'assistant',
      'The RELEASE is out',
      '2026-10-20T11:00:00.000Z',
      ada.id,
    );
    await addMessage(room.id, 'assistant', 'Room deploy note', '2026-10-20T12:00:00.000Z', ada.id);
    await addMessage(adaChat.id, 'user', 'unrelated', '2026-10-20T13:00:00.000Z');

    const rows = await repos.messages.search({ query: 'release', limit: 10 });
    expect(rows.map((row) => row.id)).toEqual([second, first]);
    expect(rows[0]).toMatchObject({
      threadId: adaChat.id,
      threadTitle: 'Ada chat',
      threadKind: 'dm',
      threadBotId: ada.id,
      threadBotName: 'Ada',
      authorBotId: ada.id,
      authorBotName: 'Ada',
      role: 'assistant',
      content: 'The RELEASE is out',
      createdAt: '2026-10-20T11:00:00.000Z',
    });
    expect(rows[1]?.role).toBe('user');
    expect(rows[1]?.authorBotId).toBeUndefined();
    expect((await repos.messages.search({ query: 'RELEASE', limit: 10 })).map((row) => row.id)).toEqual([
      second,
      first,
    ]);
    expect(await repos.messages.search({ query: 'nowhere', limit: 10 })).toEqual([]);
  });

  it('treats %, _ and \\ as literal characters instead of LIKE wildcards', async () => {
    const { adaChat } = await seedBotsAndThreads();
    const percent = await addMessage(adaChat.id, 'user', '100% done', '2026-10-20T10:00:00.000Z');
    await addMessage(adaChat.id, 'user', '1000 done', '2026-10-20T11:00:00.000Z');
    const underscore = await addMessage(adaChat.id, 'user', 'file_name', '2026-10-20T12:00:00.000Z');
    await addMessage(adaChat.id, 'user', 'filexname', '2026-10-20T13:00:00.000Z');
    const backslash = await addMessage(adaChat.id, 'user', 'C:\\path\\to', '2026-10-20T14:00:00.000Z');
    await addMessage(adaChat.id, 'user', 'C:path\to', '2026-10-20T15:00:00.000Z');

    expect((await repos.messages.search({ query: '100%', limit: 10 })).map((row) => row.id)).toEqual([percent]);
    expect((await repos.messages.search({ query: 'file_name', limit: 10 })).map((row) => row.id)).toEqual([
      underscore,
    ]);
    expect((await repos.messages.search({ query: '\\', limit: 10 })).map((row) => row.id)).toEqual([backslash]);
  });

  it('filters by thread bot, thread and oldest-than boundary, and limits in SQL', async () => {
    const { ada, grace, adaChat, graceChat, room } = await seedBotsAndThreads();
    const first = await addMessage(adaChat.id, 'user', 'needle in ada chat', '2026-10-20T10:00:00.000Z');
    const graceHit = await addMessage(graceChat.id, 'user', 'needle in grace chat', '2026-10-20T11:00:00.000Z');
    const roomHit = await addMessage(room.id, 'assistant', 'needle in room', '2026-10-20T12:00:00.000Z', grace.id);
    const second = await addMessage(adaChat.id, 'user', 'needle again', '2026-10-20T13:00:00.000Z');

    // The thread's bot is the room lead, so Ada's filter sees her room even when Grace authored the message.
    expect((await repos.messages.search({ query: 'needle', botId: ada.id, limit: 10 })).map((row) => row.id)).toEqual([
      second,
      roomHit,
      first,
    ]);
    expect((await repos.messages.search({ query: 'needle', botId: grace.id, limit: 10 })).map((row) => row.id)).toEqual([
      graceHit,
    ]);
    expect((await repos.messages.search({ query: 'needle', threadId: adaChat.id, limit: 10 })).map((row) => row.id)).toEqual([
      second,
      first,
    ]);
    expect(
      (await repos.messages.search({ query: 'needle', before: '2026-10-20T12:00:00.000Z', limit: 10 })).map(
        (row) => row.id,
      ),
    ).toEqual([graceHit, first]);
    expect(
      (await repos.messages.search({ query: 'needle', before: '2026-10-20T12:00:00Z', limit: 10 })).map((row) => row.id),
    ).toEqual([graceHit, first]);
    expect((await repos.messages.search({ query: 'needle', limit: 2 })).map((row) => row.id)).toEqual([
      second,
      roomHit,
    ]);
  });
});

describe('threads engine session', () => {
  it('stores and clears the engine session without touching updatedAt', async () => {
    const { bot } = await seed();
    const thread = await repos.threads.create(bot.id, { title: 'Chat' });

    const stored = await repos.threads.setEngineSessionId(thread.id, 'sess_9');
    expect(stored).toMatchObject({ id: thread.id, engineSessionId: 'sess_9', updatedAt: thread.updatedAt });
    expect((await repos.threads.get(thread.id))?.engineSessionId).toBe('sess_9');

    const cleared = await repos.threads.setEngineSessionId(thread.id, null);
    expect(cleared?.engineSessionId).toBeUndefined();
    expect(await repos.threads.setEngineSessionId('missing', 'x')).toBeUndefined();
  });
});

describe('computers', () => {
  it('creates a computer on first write and updates the same record afterwards', async () => {
    const { bot } = await seed();
    expect(await repos.computers.getByBot(bot.id)).toBeUndefined();

    const starting = await repos.computers.upsert(bot.id, { state: 'starting', image: 'ghcr.io/brot/computer:0.1.0' });
    expect(starting).toMatchObject({ botId: bot.id, state: 'starting', image: 'ghcr.io/brot/computer:0.1.0' });
    expect(starting.error).toBeUndefined();

    const failed = await repos.computers.upsert(bot.id, {
      state: 'error',
      image: 'ghcr.io/brot/computer:0.1.0',
      error: 'image pull failed',
    });
    expect(failed).toMatchObject({ id: starting.id, createdAt: starting.createdAt, state: 'error', error: 'image pull failed' });
    expect(await repos.computers.getByBot(bot.id)).toEqual(failed);

    const ready = await repos.computers.upsert(bot.id, { state: 'ready', image: 'ghcr.io/brot/computer:0.1.1' });
    expect(ready).toMatchObject({ id: starting.id, state: 'ready', image: 'ghcr.io/brot/computer:0.1.1' });
    expect(ready.error).toBeUndefined();
  });

  it('keeps one computer per bot', async () => {
    const { bot } = await seed();
    const other = await repos.bots.create({ name: 'Grace', job: 'x' });
    const a = await repos.computers.upsert(bot.id, { state: 'ready', image: 'img' });
    const b = await repos.computers.upsert(other.id, { state: 'stopped', image: 'img' });

    expect(a.id).not.toBe(b.id);
    expect((await repos.computers.getByBot(bot.id))?.state).toBe('ready');
    expect((await repos.computers.getByBot(other.id))?.state).toBe('stopped');
  });

  it('rejects an unknown state or an empty image', async () => {
    const { bot } = await seed();
    await expect(repos.computers.upsert(bot.id, { state: 'paused' as 'ready', image: 'img' })).rejects.toThrow();
    await expect(repos.computers.upsert(bot.id, { state: 'ready', image: '' })).rejects.toThrow();
  });
});

describe('runs', () => {
  it('lists runs by status, oldest first', async () => {
    const { bot, thread, run } = await seed();
    const second = await repos.runs.create({ threadId: thread.id, botId: bot.id, engine: 'mock' });
    await repos.runs.update(run.id, { status: 'failed', endedAt: new Date().toISOString() });

    expect((await repos.runs.listByStatus('running')).map((r) => r.id)).toEqual([second.id]);
    expect((await repos.runs.listByStatus('failed')).map((r) => r.id)).toEqual([run.id]);
    expect(await repos.runs.listByStatus('cancelled')).toEqual([]);
  });

  it('creates a running run and updates its totals', async () => {
    const { run, thread, bot } = await seed();
    expect(run).toMatchObject({ status: 'running', tokensIn: 0, tokensOut: 0, costUsd: 0, threadId: thread.id, botId: bot.id });

    const done = await repos.runs.update(run.id, {
      status: 'completed',
      tokensIn: 12,
      tokensOut: 34,
      costUsd: 0.5,
      endedAt: new Date().toISOString(),
    });
    expect(done).toMatchObject({ status: 'completed', tokensIn: 12, tokensOut: 34, costUsd: 0.5 });
    expect((await repos.runs.listByThread(thread.id)).map((r) => r.id)).toEqual([run.id]);
  });

  it('lists the runs started inside a usage range, oldest first, optionally for one bot', async () => {
    const { bot, thread } = await seed();
    const other = await repos.bots.create({ name: 'Grace', job: 'Operations' });
    const otherThread = await repos.threads.create(other.id, { title: 'Chat' });

    async function runAt(botId: string, threadId: string, startedAt: string): Promise<string> {
      const run = await repos.runs.create({ threadId, botId, engine: 'mock' });
      await handle.client.execute({ sql: 'UPDATE runs SET started_at = ? WHERE id = ?', args: [startedAt, run.id] });
      return run.id;
    }

    const before = await runAt(bot.id, thread.id, '2026-09-30T23:59:59.999Z');
    const first = await runAt(bot.id, thread.id, '2026-10-01T00:00:00.000Z');
    const second = await runAt(bot.id, thread.id, '2026-10-01T12:00:00.000Z');
    const atTo = await runAt(bot.id, thread.id, '2026-10-02T00:00:00.000Z');
    const otherBot = await runAt(other.id, otherThread.id, '2026-10-01T06:00:00.000Z');
    await handle.client.execute({
      sql: 'UPDATE runs SET status = ?, model = ?, ended_at = ?, tokens_in = ?, tokens_out = ?, cost_usd = ? WHERE id = ?',
      args: ['completed', 'mock-1', '2026-10-01T12:05:00.000Z', 11, 7, 0.25, second],
    });

    // A bound without milliseconds still matches the stored `...000Z` timestamp.
    const range = { from: '2026-10-01T00:00:00Z', to: '2026-10-02T00:00:00Z' };
    const all = await repos.runs.usage(range);
    expect(all.map((run) => run.id)).toEqual([first, otherBot, second]);
    expect(all[1]).toMatchObject({ botId: other.id, threadId: otherThread.id, status: 'running', tokensIn: 0, costUsd: 0 });
    expect(all[2]).toMatchObject({
      status: 'completed',
      engine: 'mock',
      model: 'mock-1',
      tokensIn: 11,
      tokensOut: 7,
      costUsd: 0.25,
      endedAt: '2026-10-01T12:05:00.000Z',
    });

    expect((await repos.runs.usage({ ...range, botId: bot.id })).map((run) => run.id)).toEqual([first, second]);
    expect((await repos.runs.usage({ from: '2026-09-30T00:00:00Z', to: '2026-10-01T00:00:00Z' })).map((run) => run.id)).toEqual([
      before,
    ]);
    expect((await repos.runs.usage({ from: '2026-10-02T00:00:00Z', to: '2026-10-03T00:00:00Z' })).map((run) => run.id)).toEqual([
      atTo,
    ]);
    expect(await repos.runs.usage({ from: '2026-10-03T00:00:00Z', to: '2026-10-04T00:00:00Z' })).toEqual([]);
  });
});

describe('approvals', () => {
  const approvalInput = (runId: string, threadId: string, botId: string) => ({
    runId,
    threadId,
    botId,
    kind: 'send' as const,
    tool: 'gmail.send',
    summary: 'Send the weekly report',
    args: { to: 'team@example.com' },
  });

  it('creates pending approvals and filters by status', async () => {
    const { bot, thread, run } = await seed();
    const approval = await repos.approvals.create(approvalInput(run.id, thread.id, bot.id));
    expect(approval).toMatchObject({ status: 'pending', args: { to: 'team@example.com' } });

    expect((await repos.approvals.list({ status: 'pending' })).map((a) => a.id)).toEqual([approval.id]);
    expect(await repos.approvals.list({ status: 'allowed' })).toEqual([]);
  });

  it('resolves once and keeps the first decision', async () => {
    const { bot, thread, run } = await seed();
    const approval = await repos.approvals.create(approvalInput(run.id, thread.id, bot.id));

    const allowed = await repos.approvals.resolve(approval.id, { decision: 'allow_once', reply: 'ok' });
    expect(allowed).toMatchObject({ status: 'allowed', decision: 'allow_once', reply: 'ok' });
    expect(allowed?.resolvedAt).toBeDefined();

    const again = await repos.approvals.resolve(approval.id, { decision: 'deny' });
    expect(again).toEqual(allowed);
    expect(await repos.approvals.resolve('missing', { decision: 'deny' })).toBeUndefined();
  });

  it('denies when the decision is deny', async () => {
    const { bot, thread, run } = await seed();
    const approval = await repos.approvals.create(approvalInput(run.id, thread.id, bot.id));
    const denied = await repos.approvals.resolve(approval.id, { decision: 'deny' });
    expect(denied).toMatchObject({ status: 'denied', decision: 'deny' });
  });
});

describe('policies', () => {
  it('creates, lists per bot, and removes policies', async () => {
    const { bot } = await seed();
    const policy = await repos.policies.create(bot.id, { tool: 'shell', argPattern: 'ls *', effect: 'allow' });
    expect(policy).toMatchObject({ tool: 'shell', argPattern: 'ls *', effect: 'allow' });
    expect(await repos.policies.listByBot(bot.id)).toEqual([policy]);
    expect(await repos.policies.remove(policy.id)).toBe(true);
    expect(await repos.policies.listByBot(bot.id)).toEqual([]);
  });
});

describe('memories', () => {
  it('creates with a source run, updates content, and removes', async () => {
    const { bot, run } = await seed();
    const memory = await repos.memories.create(bot.id, { kind: 'fact', content: 'Likes tea', sourceRunId: run.id });
    expect(memory).toMatchObject({ kind: 'fact', content: 'Likes tea', sourceRunId: run.id });

    const updated = await repos.memories.update(memory.id, { content: 'Prefers green tea' });
    expect(updated).toMatchObject({ content: 'Prefers green tea', kind: 'fact' });
    expect((await repos.memories.get(memory.id))?.content).toBe('Prefers green tea');

    expect((await repos.memories.listByBot(bot.id)).map((m) => m.id)).toEqual([memory.id]);
    expect(await repos.memories.remove(memory.id)).toBe(true);
    expect(await repos.memories.get(memory.id)).toBeUndefined();
  });
});

describe('workspace memories', () => {
  it('keeps bot and workspace memories apart', async () => {
    const { bot } = await seed();
    const botMemory = await repos.memories.create(bot.id, { kind: 'fact', content: 'Likes tea' });
    const workspace = await repos.memories.create({ scope: 'workspace', kind: 'preference', content: 'Works in Lisbon' });

    expect(botMemory).toMatchObject({ botId: bot.id, scope: 'bot' });
    expect(workspace).toMatchObject({ scope: 'workspace', kind: 'preference' });
    expect(workspace.botId).toBeUndefined();
    expect((await repos.memories.listByBot(bot.id)).map((memory) => memory.id)).toEqual([botMemory.id]);
    expect((await repos.memories.listWorkspace()).map((memory) => memory.id)).toEqual([workspace.id]);
    expect((await repos.memories.get(workspace.id))?.scope).toBe('workspace');

    expect((await repos.memories.update(workspace.id, { content: 'Lives in Lisbon' }))).toMatchObject({
      content: 'Lives in Lisbon',
      scope: 'workspace',
    });
    expect(await repos.memories.remove(workspace.id)).toBe(true);
    expect(await repos.memories.listWorkspace()).toEqual([]);
  });

  it('requires a bot for a bot memory and refuses one for a workspace memory', async () => {
    const { bot } = await seed();

    await expect(repos.memories.create({ kind: 'fact', content: 'x' })).rejects.toThrow(/needs a botId/);
    await expect(
      repos.memories.create({ scope: 'workspace', botId: bot.id, kind: 'fact', content: 'x' }),
    ).rejects.toThrow(/has no botId/);
    expect(await repos.memories.listWorkspace()).toEqual([]);
    expect(await repos.memories.listByBot(bot.id)).toEqual([]);
  });
});

describe('skills', () => {
  it('starts at version 1 and bumps the version on every update', async () => {
    const skill = await repos.skills.create({ name: 'summarize', description: 'Summarize', body: 'v1' });
    expect(skill.version).toBe(1);

    const v2 = await repos.skills.update(skill.id, { body: 'v2' });
    const v3 = await repos.skills.update(skill.id, { description: 'Short summary' });
    expect(v2).toMatchObject({ version: 2, body: 'v2' });
    expect(v3).toMatchObject({ version: 3, body: 'v2', description: 'Short summary' });
  });

  it('separates bot-owned and global skills', async () => {
    const { bot } = await seed();
    const other = await repos.bots.create({ name: 'Grace', job: 'x' });
    const global = await repos.skills.create({ name: 'global', description: 'd', body: 'b' });
    const owned = await repos.skills.create({ name: 'owned', description: 'd', body: 'b', botId: bot.id });
    const foreign = await repos.skills.create({ name: 'foreign', description: 'd', body: 'b', botId: other.id });

    expect((await repos.skills.list({ botId: bot.id })).map((s) => s.id)).toEqual([owned.id]);
    expect((await repos.skills.list()).map((s) => s.id).sort()).toEqual([global.id, owned.id, foreign.id].sort());
    expect((await repos.skills.listForBot(bot.id)).map((s) => s.id).sort()).toEqual([global.id, owned.id].sort());
    expect(await repos.skills.remove(global.id)).toBe(true);
  });
});

describe('routines', () => {
  it('defaults to enabled and finds webhook routines by secret', async () => {
    const { bot } = await seed();
    const cron = await repos.routines.create({
      botId: bot.id,
      name: 'Daily',
      instruction: 'Summarize news',
      trigger: { type: 'cron', cron: '0 9 * * *' },
    });
    const hook = await repos.routines.create({
      botId: bot.id,
      name: 'Deploy hook',
      instruction: 'Report deploy',
      trigger: { type: 'webhook', secret: 'hook-secret-123' },
      enabled: false,
    });

    expect(cron.enabled).toBe(true);
    expect(await repos.routines.findByWebhookSecret('hook-secret-123')).toEqual(hook);
    expect(await repos.routines.findByWebhookSecret('0 9 * * *')).toBeUndefined();
    expect(await repos.routines.findByWebhookSecret('unknown')).toBeUndefined();
    expect((await repos.routines.list({ botId: bot.id })).map((r) => r.id).sort()).toEqual(
      [cron.id, hook.id].sort(),
    );
  });

  it('updates editable fields and schedule timestamps', async () => {
    const { bot } = await seed();
    const routine = await repos.routines.create({
      botId: bot.id,
      name: 'Daily',
      instruction: 'Summarize',
      trigger: { type: 'cron', cron: '0 9 * * *' },
    });
    const when = '2026-10-20T09:00:00.000Z';
    const updated = await repos.routines.update(routine.id, {
      enabled: false,
      trigger: { type: 'cron', cron: '0 10 * * *' },
      nextRunAt: when,
    });
    expect(updated).toMatchObject({ enabled: false, trigger: { type: 'cron', cron: '0 10 * * *' }, nextRunAt: when, name: 'Daily' });
    expect(await repos.routines.remove(routine.id)).toBe(true);
  });

  it('stores a timezone, defaults catch-up on, and remembers the last run when asked', async () => {
    const { bot } = await seed();
    const routine = await repos.routines.create({
      botId: bot.id,
      name: 'Daily',
      instruction: 'Summarize',
      trigger: { type: 'cron', cron: '0 9 * * *', timezone: 'America/Sao_Paulo' },
    });
    expect(routine).toMatchObject({
      catchUp: true,
      rememberLastRun: false,
      trigger: { type: 'cron', cron: '0 9 * * *', timezone: 'America/Sao_Paulo' },
    });

    const updated = await repos.routines.update(routine.id, { catchUp: false, rememberLastRun: true });
    expect(updated).toMatchObject({ catchUp: false, rememberLastRun: true });
    expect(await repos.routines.get(routine.id)).toMatchObject({ catchUp: false, rememberLastRun: true });
  });
});

describe('routine runs', () => {
  async function seedRoutine() {
    const { bot } = await seed();
    const routine = await repos.routines.create({
      botId: bot.id,
      name: 'Daily',
      instruction: 'Summarize',
      trigger: { type: 'cron', cron: '0 9 * * *' },
    });
    const thread = await repos.threads.create(bot.id, { title: 'Daily' });
    return { bot, routine, thread };
  }

  it('stores runs newest first and filters them by routine, bot, status, and limit', async () => {
    const { bot, routine, thread } = await seedRoutine();
    const first = await repos.routineRuns.create({
      routineId: routine.id,
      botId: bot.id,
      threadId: thread.id,
      trigger: 'schedule',
      startedAt: '2026-10-20T09:00:00.000Z',
    });
    const second = await repos.routineRuns.create({
      routineId: routine.id,
      botId: bot.id,
      threadId: thread.id,
      trigger: 'manual',
      startedAt: '2026-10-21T09:00:00.000Z',
    });
    expect(first).toMatchObject({ status: 'running', routineId: routine.id, threadId: thread.id });
    expect(first.endedAt).toBeUndefined();

    expect((await repos.routineRuns.listByRoutine(routine.id)).map((r) => r.id)).toEqual([second.id, first.id]);
    expect((await repos.routineRuns.listByRoutine(routine.id, { limit: 1 })).map((r) => r.id)).toEqual([second.id]);
    expect((await repos.routineRuns.list({ botId: bot.id })).map((r) => r.id)).toEqual([second.id, first.id]);
    expect((await repos.routineRuns.list({ status: 'running' })).map((r) => r.id)).toEqual([second.id, first.id]);
    expect(await repos.routineRuns.list({ status: 'completed' })).toEqual([]);
  });

  it('tracks active runs and the latest completed one', async () => {
    const { bot, routine, thread } = await seedRoutine();
    expect(await repos.routineRuns.activeByRoutine(routine.id)).toEqual([]);
    expect(await repos.routineRuns.latestCompleted(routine.id)).toBeUndefined();

    const queued = await repos.routineRuns.create({
      routineId: routine.id,
      botId: bot.id,
      threadId: thread.id,
      trigger: 'webhook',
      status: 'queued',
    });
    const completed = await repos.routineRuns.create({
      routineId: routine.id,
      botId: bot.id,
      threadId: thread.id,
      trigger: 'manual',
      startedAt: '2026-10-20T09:00:00.000Z',
    });
    const linked = await repos.routineRuns.update(completed.id, {
      status: 'completed',
      endedAt: '2026-10-20T09:01:00.000Z',
      result: 'All quiet.',
    });
    expect(linked).toMatchObject({ status: 'completed', endedAt: '2026-10-20T09:01:00.000Z', result: 'All quiet.' });

    expect((await repos.routineRuns.activeByRoutine(routine.id)).map((r) => r.id)).toEqual([queued.id]);
    expect((await repos.routineRuns.latestCompleted(routine.id))?.id).toBe(completed.id);
  });

  it('links the engine run and clears the link when that run is deleted', async () => {
    const { bot, routine, thread } = await seedRoutine();
    const engineRun = await repos.runs.create({ threadId: thread.id, botId: bot.id, engine: 'mock' });
    const run = await repos.routineRuns.create({
      routineId: routine.id,
      botId: bot.id,
      threadId: thread.id,
      trigger: 'schedule',
      runId: engineRun.id,
    });
    expect(run.runId).toBe(engineRun.id);

    await handle.client.execute({ sql: 'DELETE FROM runs WHERE id = ?', args: [engineRun.id] });
    expect((await repos.routineRuns.get(run.id))?.runId).toBeUndefined();
  });

  it('deletes a routine runs with it', async () => {
    const { bot, routine, thread } = await seedRoutine();
    const run = await repos.routineRuns.create({
      routineId: routine.id,
      botId: bot.id,
      threadId: thread.id,
      trigger: 'manual',
    });
    expect(await repos.routines.remove(routine.id)).toBe(true);
    expect(await repos.routineRuns.get(run.id)).toBeUndefined();
  });
});

describe('devices', () => {
  it('stores devices without exposing the token hash', async () => {
    const device = await repos.devices.create({
      name: 'Phone',
      role: 'approver',
      publicKey: 'pk-1',
      tokenHash: 'hash-1',
    });
    expect(device).not.toHaveProperty('tokenHash');
    expect(device).toMatchObject({ name: 'Phone', role: 'approver', publicKey: 'pk-1' });

    const found = await repos.devices.findByTokenHash('hash-1');
    expect(found?.id).toBe(device.id);
    expect(await repos.devices.findByTokenHash('nope')).toBeUndefined();

    const seen = await repos.devices.touch(device.id);
    expect(seen?.lastSeenAt).toBeDefined();
    expect((await repos.devices.list()).map((d) => d.id)).toEqual([device.id]);
    expect(await repos.devices.remove(device.id)).toBe(true);
  });

  it('rejects duplicate token hashes', async () => {
    await repos.devices.create({ name: 'A', role: 'full', publicKey: 'pk', tokenHash: 'same' });
    await expect(
      repos.devices.create({ name: 'B', role: 'full', publicKey: 'pk', tokenHash: 'same' }),
    ).rejects.toThrow();
  });
});

describe('events', () => {
  it('appends and lists events in order with filters', async () => {
    const { bot, thread, run } = await seed();
    const started: CanonicalEvent = {
      id: 'evt-1',
      at: '2026-10-19T12:00:00.000Z',
      threadId: thread.id,
      runId: run.id,
      type: 'run.started',
      botId: bot.id,
      engine: 'mock',
    };
    const delta: CanonicalEvent = {
      id: 'evt-2',
      at: '2026-10-19T12:00:01.000Z',
      threadId: thread.id,
      runId: run.id,
      type: 'message.delta',
      messageId: 'm1',
      delta: 'Hi',
    };
    const completed: CanonicalEvent = {
      id: 'evt-3',
      at: '2026-10-19T12:00:02.000Z',
      threadId: thread.id,
      type: 'run.completed',
    };

    expect(await repos.events.append(started)).toEqual(started);
    await repos.events.append(delta);
    await repos.events.append(completed);

    expect(await repos.events.list({ threadId: thread.id })).toEqual([started, delta, completed]);
    expect(await repos.events.list({ threadId: thread.id, after: started.at })).toEqual([delta, completed]);
    expect(await repos.events.list({ threadId: thread.id, limit: 1 })).toEqual([started]);
    expect(await repos.events.list({ threadId: 'other-thread' })).toEqual([]);
  });

  it('rejects events that do not match the protocol', async () => {
    const { thread } = await seed();
    await expect(
      repos.events.append({ id: 'bad', at: 'nope', threadId: thread.id, type: 'run.completed' } as CanonicalEvent),
    ).rejects.toThrow();
  });
});

describe('cascade on bot delete', () => {
  it('removes every bot-owned row and keeps global skills', async () => {
    const { bot, thread, run } = await seed();
    await repos.messages.create({ threadId: thread.id, role: 'user', content: 'hi' });
    await repos.approvals.create({
      runId: run.id,
      threadId: thread.id,
      botId: bot.id,
      kind: 'shell',
      tool: 'bash',
      summary: 'ls',
      args: {},
    });
    const botMemory = await repos.memories.create(bot.id, { kind: 'fact', content: 'x', sourceRunId: run.id });
    const workspaceMemory = await repos.memories.create({
      scope: 'workspace',
      kind: 'preference',
      content: 'Works in Lisbon',
    });
    await repos.policies.create(bot.id, { tool: 'bash', effect: 'deny' });
    await repos.routines.create({
      botId: bot.id,
      name: 'r',
      instruction: 'i',
      trigger: { type: 'webhook', secret: 'cascade-secret' },
    });
    await repos.skills.create({ name: 'owned', description: 'd', body: 'b', botId: bot.id });
    const global = await repos.skills.create({ name: 'global', description: 'd', body: 'b' });
    await repos.events.append({
      id: 'evt-cascade',
      at: '2026-10-19T12:00:00.000Z',
      threadId: thread.id,
      type: 'run.completed',
    });
    await repos.computers.upsert(bot.id, { state: 'ready', image: 'img' });

    expect(await repos.bots.remove(bot.id)).toBe(true);
    expect(await repos.computers.getByBot(bot.id)).toBeUndefined();

    expect(await repos.threads.listByBot(bot.id)).toEqual([]);
    expect(await repos.messages.listByThread(thread.id)).toEqual([]);
    expect(await repos.runs.listByThread(thread.id)).toEqual([]);
    expect(await repos.approvals.list()).toEqual([]);
    expect(await repos.memories.listByBot(bot.id)).toEqual([]);
    expect(await repos.memories.get(botMemory.id)).toBeUndefined();
    expect((await repos.memories.listWorkspace()).map((memory) => memory.id)).toEqual([workspaceMemory.id]);
    expect(await repos.policies.listByBot(bot.id)).toEqual([]);
    expect(await repos.routines.list({ botId: bot.id })).toEqual([]);
    expect(await repos.routines.findByWebhookSecret('cascade-secret')).toBeUndefined();
    expect(await repos.events.list({ threadId: thread.id })).toEqual([]);
    expect((await repos.skills.list()).map((s) => s.id)).toEqual([global.id]);
  });
});

async function seedRoom(count = 3) {
  const bots = [];
  for (let i = 0; i < count; i++) bots.push(await repos.bots.create({ name: `Bot ${i + 1}`, job: 'x' }));
  const [lead] = bots;
  if (!lead) throw new Error('seedRoom needs at least one bot');
  const room = await repos.rooms.create({
    title: 'Launch',
    botIds: bots.map((bot) => bot.id),
    leadBotId: lead.id,
  });
  return { bots, lead, room };
}

const memberIds = async (threadId: string) =>
  (await repos.rooms.listMembers(threadId)).map((member) => member.botId).sort();

describe('rooms', () => {
  it('creates a room with its lead as botId, the lead responder by default, and its members', async () => {
    const { bots, lead, room } = await seedRoom(3);

    expect(room).toMatchObject({
      kind: 'room',
      title: 'Launch',
      botId: lead.id,
      leadBotId: lead.id,
      responder: 'lead',
    });
    expect(await memberIds(room.id)).toEqual(bots.map((bot) => bot.id).sort());
    expect(await repos.threads.get(room.id)).toEqual(room);
  });

  it('keeps rooms out of the DM list when asked', async () => {
    const { lead, room } = await seedRoom(2);
    const dm = await repos.threads.create(lead.id, { title: 'Chat' });

    expect((await repos.threads.listByBot(lead.id)).map((t) => t.id).sort()).toEqual([dm.id, room.id].sort());
    expect((await repos.threads.listByBot(lead.id, { kind: 'dm' })).map((t) => t.id)).toEqual([dm.id]);
    expect((await repos.threads.listByBot(lead.id, { kind: 'room' })).map((t) => t.id)).toEqual([room.id]);
    expect(dm.kind).toBe('dm');
    expect(dm.leadBotId).toBeUndefined();
  });

  it('rejects a room whose lead is not a member, or that names an unknown bot', async () => {
    const { bots } = await seedRoom(2);
    await expect(
      repos.rooms.create({ title: 'x', botIds: bots.map((b) => b.id), leadBotId: 'bot_missing' }),
    ).rejects.toThrow(/lead bot/);
    await expect(
      repos.rooms.create({ title: 'x', botIds: [bots[0]!.id, 'bot_missing'], leadBotId: bots[0]!.id }),
    ).rejects.toThrow();
  });

  it('adds and removes members, ignoring no-op changes', async () => {
    const { bots, lead, room } = await seedRoom(2);
    const extra = await repos.bots.create({ name: 'Extra', job: 'x' });

    const added = await repos.rooms.updateMembers(room.id, { add: [extra.id, lead.id] });
    expect(added?.map((m) => m.botId).sort()).toEqual([...bots.map((b) => b.id), extra.id].sort());

    const removed = await repos.rooms.updateMembers(room.id, { remove: [bots[1]!.id, 'bot_never_joined'] });
    expect(removed?.map((m) => m.botId).sort()).toEqual([lead.id, extra.id].sort());
    expect(removed?.every((m) => m.threadId === room.id)).toBe(true);
  });

  it('refuses a change that removes the lead, leaves fewer than two bots, or passes twelve', async () => {
    const { bots, lead, room } = await seedRoom(2);

    await expect(repos.rooms.updateMembers(room.id, { remove: [lead.id] })).rejects.toThrow(/lead bot cannot leave/);
    await expect(repos.rooms.updateMembers(room.id, { remove: [bots[1]!.id] })).rejects.toThrow(/2 to 12/);
    expect(await memberIds(room.id)).toEqual(bots.map((b) => b.id).sort());

    const crowd = [];
    for (let i = 0; i < 10; i++) crowd.push((await repos.bots.create({ name: `Crowd ${i}`, job: 'x' })).id);
    await repos.rooms.updateMembers(room.id, { add: crowd });
    expect((await repos.rooms.listMembers(room.id)).length).toBe(12);
    const thirteenth = await repos.bots.create({ name: 'Thirteenth', job: 'x' });
    await expect(repos.rooms.updateMembers(room.id, { add: [thirteenth.id] })).rejects.toThrow(/12/);
    expect((await repos.rooms.listMembers(room.id)).length).toBe(12);
  });

  it('returns undefined for an unknown thread and refuses to change a DM as if it were a room', async () => {
    const { lead } = await seedRoom(2);
    const dm = await repos.threads.create(lead.id, { title: 'Chat' });
    expect(await repos.rooms.updateMembers('missing', { add: [lead.id] })).toBeUndefined();
    await expect(repos.rooms.updateMembers(dm.id, { add: [lead.id] })).rejects.toThrow(/not a room/);
    expect(await repos.rooms.listMembers(dm.id)).toEqual([]);
  });

  it('removes a room when its lead bot is deleted, and a member when that bot is deleted', async () => {
    const { bots, lead, room } = await seedRoom(3);
    const member = bots[2]!;

    expect(await repos.bots.remove(member.id)).toBe(true);
    expect(await memberIds(room.id)).toEqual(bots.slice(0, 2).map((b) => b.id).sort());

    expect(await repos.bots.remove(lead.id)).toBe(true);
    expect(await repos.threads.get(room.id)).toBeUndefined();
    expect(await repos.rooms.listMembers(room.id)).toEqual([]);
  });
});

describe('message team fields', () => {
  it('stores the author, mentions, and recipient of a bot message and returns them', async () => {
    const { lead, room, bots } = await seedRoom(2);
    const [, second] = bots;
    const message = await repos.messages.create({
      threadId: room.id,
      role: 'assistant',
      content: 'Over to you, Capy',
      authorBotId: lead.id,
      mentions: [second!.id],
      viaBotId: second!.id,
    });
    expect(message).toMatchObject({ authorBotId: lead.id, mentions: [second!.id], viaBotId: second!.id });
    expect((await repos.messages.listByThread(room.id))[0]).toEqual(message);
  });

  it('leaves the team fields absent on a plain message and rejects malformed mentions', async () => {
    const { lead } = await seedRoom(2);
    const thread = await repos.threads.create(lead.id, { title: 'Chat' });
    const plain = await repos.messages.create({ threadId: thread.id, role: 'user', content: 'hi' });
    expect(plain.authorBotId).toBeUndefined();
    expect(plain.mentions).toBeUndefined();
    expect(plain.viaBotId).toBeUndefined();
    await expect(
      repos.messages.create({ threadId: thread.id, role: 'user', content: 'x', mentions: 'bot_1' as unknown as string[] }),
    ).rejects.toThrow();
  });
});

describe('thread sessions', () => {
  it('stores one session per bot per thread and upserts it', async () => {
    const { bots, room } = await seedRoom(2);
    const [first, second] = bots;

    expect(await repos.threadSessions.get(room.id, first!.id)).toBeUndefined();
    await repos.threadSessions.set(room.id, first!.id, 'sess_a1');
    await repos.threadSessions.set(room.id, second!.id, 'sess_b1');
    expect(await repos.threadSessions.get(room.id, first!.id)).toBe('sess_a1');
    expect(await repos.threadSessions.get(room.id, second!.id)).toBe('sess_b1');

    await repos.threadSessions.set(room.id, first!.id, 'sess_a2');
    expect(await repos.threadSessions.get(room.id, first!.id)).toBe('sess_a2');
    const rows = await handle.client.execute({
      sql: 'SELECT COUNT(*) AS n FROM thread_sessions WHERE thread_id = ? AND bot_id = ?',
      args: [room.id, first!.id],
    });
    expect(Number(rows.rows[0]?.n)).toBe(1);

    await repos.threadSessions.set(room.id, first!.id, null);
    expect(await repos.threadSessions.get(room.id, first!.id)).toBeUndefined();
    expect(await repos.threadSessions.get(room.id, second!.id)).toBe('sess_b1');
  });

  it('removes a thread session with its thread', async () => {
    const { bots, room } = await seedRoom(2);
    await repos.threadSessions.set(room.id, bots[0]!.id, 'sess_a1');
    expect(await repos.threads.get(room.id)).toBeDefined();
    await handle.client.execute({ sql: 'DELETE FROM threads WHERE id = ?', args: [room.id] });
    expect(await repos.threadSessions.get(room.id, bots[0]!.id)).toBeUndefined();
  });
});

describe('team tasks', () => {
  async function seedChain() {
    const { bots, room } = await seedRoom(3);
    const [user, onca, capy] = bots;
    const root = await repos.tasks.create({
      title: 'Launch the post',
      assigneeBotId: onca!.id,
      threadId: room.id,
    });
    return { user: user!, onca: onca!, capy: capy!, room, root };
  }

  it('creates a user task as depth 0 that starts its own chain', async () => {
    const { onca, room, root } = await seedChain();
    expect(root).toMatchObject({
      title: 'Launch the post',
      status: 'open',
      assigneeBotId: onca.id,
      createdByUser: true,
      threadId: room.id,
      chainId: root.id,
      depth: 0,
    });
    expect(root.createdByBotId).toBeUndefined();
    expect(root.parentTaskId).toBeUndefined();
    expect(await repos.tasks.get(root.id)).toEqual(root);
  });

  it('places a delegated task one level below its parent, in the parent chain', async () => {
    const { onca, capy, room, root } = await seedChain();
    const child = await repos.tasks.create({
      title: 'Draft the copy',
      description: 'Two short paragraphs',
      assigneeBotId: capy.id,
      createdByBotId: onca.id,
      parentTaskId: root.id,
      threadId: room.id,
    });
    expect(child).toMatchObject({
      createdByUser: false,
      createdByBotId: onca.id,
      parentTaskId: root.id,
      chainId: root.chainId,
      depth: 1,
      description: 'Two short paragraphs',
    });
  });

  it('starts a new chain for a delegation with no parent, at depth 1', async () => {
    const { onca, capy, room } = await seedChain();
    const loose = await repos.tasks.create({
      title: 'Check the links',
      assigneeBotId: capy.id,
      createdByBotId: onca.id,
      threadId: room.id,
    });
    expect(loose).toMatchObject({ depth: 1, chainId: loose.id, createdByUser: false });
    expect(loose.parentTaskId).toBeUndefined();
  });

  it('joins sibling delegations to one chain when the caller names it', async () => {
    const { onca, capy, room } = await seedChain();
    const first = await repos.tasks.create({ title: 'Fix the bug', assigneeBotId: capy.id, createdByBotId: onca.id, threadId: room.id });
    const second = await repos.tasks.create({
      title: 'Write the email',
      assigneeBotId: capy.id,
      createdByBotId: onca.id,
      threadId: room.id,
      chainId: first.chainId,
    });
    expect(second).toMatchObject({ chainId: first.chainId, depth: 1 });
  });

  it('refuses a delegation below the deepest allowed level', async () => {
    const { onca, capy, room, root } = await seedChain();
    let parent = root;
    for (let depth = 1; depth <= 3; depth++) {
      parent = await repos.tasks.create({
        title: `Level ${depth}`,
        assigneeBotId: capy.id,
        createdByBotId: onca.id,
        parentTaskId: parent.id,
        threadId: room.id,
      });
      expect(parent.depth).toBe(depth);
    }
    await expect(
      repos.tasks.create({
        title: 'Too deep',
        assigneeBotId: capy.id,
        createdByBotId: onca.id,
        parentTaskId: parent.id,
        threadId: room.id,
      }),
    ).rejects.toThrow(/at most depth 3/);
    expect(await repos.tasks.list({ chainId: root.chainId })).toHaveLength(4);
  });

  it('caps a chain at twenty tasks, the root included', async () => {
    const { onca, capy, room, root } = await seedChain();
    for (let i = 1; i < 20; i++) {
      await repos.tasks.create({
        title: `Child ${i}`,
        assigneeBotId: capy.id,
        createdByBotId: onca.id,
        parentTaskId: root.id,
        threadId: room.id,
      });
    }
    expect(await repos.tasks.list({ chainId: root.chainId })).toHaveLength(20);
    await expect(
      repos.tasks.create({
        title: 'Twenty-first',
        assigneeBotId: capy.id,
        createdByBotId: onca.id,
        parentTaskId: root.id,
        threadId: room.id,
      }),
    ).rejects.toThrow(/20 tasks/);
  });

  it('refuses a delegation under a parent that does not exist', async () => {
    const { onca, capy, room } = await seedChain();
    await expect(
      repos.tasks.create({
        title: 'Orphan',
        assigneeBotId: capy.id,
        createdByBotId: onca.id,
        parentTaskId: 'task_missing',
        threadId: room.id,
      }),
    ).rejects.toThrow(/does not exist/);
  });

  it('filters the board by assignee, status, chain, and thread', async () => {
    const { onca, capy, room, root } = await seedChain();
    const child = await repos.tasks.create({
      title: 'Draft',
      assigneeBotId: capy.id,
      createdByBotId: onca.id,
      parentTaskId: root.id,
      threadId: room.id,
    });
    const otherRoom = await repos.rooms.create({ title: 'Other', botIds: [onca.id, capy.id], leadBotId: onca.id });
    const elsewhere = await repos.tasks.create({
      title: 'Elsewhere',
      assigneeBotId: capy.id,
      threadId: otherRoom.id,
    });
    await repos.tasks.update(child.id, { status: 'done' });

    const ids = async (filter: Parameters<typeof repos.tasks.list>[0]) =>
      (await repos.tasks.list(filter)).map((task) => task.id).sort();
    expect(await ids({})).toEqual([root.id, child.id, elsewhere.id].sort());
    expect(await ids({ assigneeBotId: capy.id })).toEqual([child.id, elsewhere.id].sort());
    expect(await ids({ status: 'done' })).toEqual([child.id]);
    expect(await ids({ chainId: root.chainId })).toEqual([root.id, child.id].sort());
    expect(await ids({ threadId: otherRoom.id })).toEqual([elsewhere.id]);
    expect(await ids({ assigneeBotId: capy.id, status: 'open', threadId: room.id })).toEqual([]);
    expect((await repos.tasks.listChildren(root.id)).map((task) => task.id)).toEqual([child.id]);
    expect(await repos.tasks.listChildren(child.id)).toEqual([]);
  });

  it('updates status, result, assignee, and work thread, and bumps updatedAt', async () => {
    const { onca, capy, room, root } = await seedChain();
    const workThread = await repos.threads.create(capy.id, { title: 'Work on: Launch the post' });

    const started = await repos.tasks.update(root.id, { status: 'in_progress', workThreadId: workThread.id });
    expect(started).toMatchObject({ status: 'in_progress', workThreadId: workThread.id });
    expect(started!.updatedAt >= root.updatedAt).toBe(true);

    const done = await repos.tasks.update(root.id, { status: 'done', result: 'Posted', assigneeBotId: capy.id });
    expect(done).toMatchObject({ status: 'done', result: 'Posted', assigneeBotId: capy.id, workThreadId: workThread.id });
    expect((await repos.tasks.list({ assigneeBotId: onca.id })).map((t) => t.id)).toEqual([]);
    expect(room.id).toBe(root.threadId);

    expect(await repos.tasks.update('task_missing', { status: 'done' })).toBeUndefined();
    await expect(repos.tasks.update(root.id, {})).rejects.toThrow(/at least one field/);
  });

  it('keeps a delegated task when its creator bot is deleted, without a creator', async () => {
    const { onca, capy, room } = await seedChain();
    const child = await repos.tasks.create({
      title: 'Orphaned work',
      assigneeBotId: capy.id,
      createdByBotId: onca.id,
      threadId: room.id,
    });
    expect(await repos.bots.remove(onca.id)).toBe(true);
    const survivor = await repos.tasks.get(child.id);
    expect(survivor).toMatchObject({ createdByUser: false, depth: 1 });
    expect(survivor?.createdByBotId).toBeUndefined();
  });

  it('deletes a task with its assignee', async () => {
    const { capy, room } = await seedChain();
    const task = await repos.tasks.create({ title: 'Gone soon', assigneeBotId: capy.id, threadId: room.id });
    expect(await repos.bots.remove(capy.id)).toBe(true);
    expect(await repos.tasks.get(task.id)).toBeUndefined();
  });
});

describe('listing rooms', () => {
  it('lists only room threads, most recently updated first', async () => {
    const { lead, room: older } = await seedRoom(2);
    const dm = await repos.threads.create(lead.id, { title: 'Chat' });
    const newer = await repos.rooms.create({ title: 'Second', botIds: [lead.id, (await repos.bots.create({ name: 'Capy', job: 'x' })).id], leadBotId: lead.id });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await repos.threads.touch(older.id);

    const rooms = await repos.threads.listRooms();
    expect(rooms.map((room) => room.kind)).toEqual(['room', 'room']);
    expect(rooms.map((room) => room.id).sort()).toEqual([older.id, newer.id].sort());
    expect(rooms.find((room) => room.id === dm.id)).toBeUndefined();
    expect(rooms[0]?.id).toBe(older.id);
  });

  it('returns no rooms when there are none', async () => {
    const bot = await repos.bots.create({ name: 'Ada', job: 'x' });
    await repos.threads.create(bot.id, { title: 'Chat' });
    expect(await repos.threads.listRooms()).toEqual([]);
  });
});

describe('clearing a bot session', () => {
  it('clears one bot\'s room sessions and DM sessions everywhere, and leaves other bots alone', async () => {
    const { bots, room } = await seedRoom(2);
    const [ada, grace] = bots;
    const dm = await repos.threads.create(ada!.id, { title: 'Chat' });
    const graceDm = await repos.threads.create(grace!.id, { title: 'Chat' });
    await repos.threadSessions.set(room.id, ada!.id, 'sess_room_ada');
    await repos.threadSessions.set(room.id, grace!.id, 'sess_room_grace');
    await repos.threads.setEngineSessionId(dm.id, 'sess_dm_ada');
    await repos.threads.setEngineSessionId(graceDm.id, 'sess_dm_grace');

    await repos.threadSessions.clearBot(ada!.id);

    expect(await repos.threadSessions.get(room.id, ada!.id)).toBeUndefined();
    expect(await repos.threadSessions.get(room.id, grace!.id)).toBe('sess_room_grace');
    expect((await repos.threads.get(dm.id))?.engineSessionId).toBeUndefined();
    expect((await repos.threads.get(graceDm.id))?.engineSessionId).toBe('sess_dm_grace');
    const rows = await handle.client.execute({
      sql: 'SELECT engine_session_id FROM thread_sessions WHERE thread_id = ? AND bot_id = ?',
      args: [room.id, ada!.id],
    });
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.engine_session_id).toBeNull();
  });

  it('does not move updatedAt on sessions that were already clear', async () => {
    const { bots, room } = await seedRoom(2);
    const ada = bots[0]!;
    const updatedAt = async () =>
      (
        await handle.client.execute({
          sql: 'SELECT updated_at FROM thread_sessions WHERE thread_id = ? AND bot_id = ?',
          args: [room.id, ada.id],
        })
      ).rows[0]?.updated_at;

    await repos.threadSessions.set(room.id, ada.id, 'sess_1');
    await repos.threadSessions.clearBot(ada.id);
    const cleared = await updatedAt();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await repos.threadSessions.clearBot(ada.id);
    expect(await updatedAt()).toBe(cleared);
  });
});

describe('events after a cursor', () => {
  it('returns the events after the cursor in log order, filtered in SQL', async () => {
    const { bot, thread, run } = await seed();
    const at = '2026-10-19T12:00:00.000Z';
    const ids = ['evt-a', 'evt-b', 'evt-c', 'evt-d'];
    for (const [i, id] of ids.entries()) {
      await repos.events.append({
        id,
        at: i < 2 ? at : '2026-10-19T12:00:01.000Z',
        threadId: thread.id,
        runId: run.id,
        type: 'message.delta',
        messageId: 'm1',
        delta: String(i),
      });
    }
    await repos.events.append({ id: 'evt-other', at, threadId: (await repos.threads.create(bot.id)).id, type: 'run.completed' });

    const afterFirst = await repos.events.listAfter(thread.id, 'evt-a');
    expect(afterFirst?.map((event) => event.id)).toEqual(['evt-b', 'evt-c', 'evt-d']);
    expect((await repos.events.listAfter(thread.id, 'evt-d'))).toEqual([]);
    expect((await repos.events.listAfter(thread.id, 'evt-a', { limit: 1 }))?.map((e) => e.id)).toEqual(['evt-b']);
  });

  it('gets one event by id', async () => {
    const { thread, run } = await seed();
    await repos.events.append({
      id: 'evt-get',
      at: '2026-10-19T12:00:00.000Z',
      threadId: thread.id,
      runId: run.id,
      type: 'message.delta',
      messageId: 'm1',
      delta: 'hi',
    });
    expect((await repos.events.get('evt-get'))?.type).toBe('message.delta');
    expect((await repos.events.get('nope'))).toBeUndefined();
  });

  it('lists the events strictly after an event id, including same-timestamp ties in rowid order', async () => {
    const { bot, thread, run } = await seed();
    const other = await repos.threads.create(bot.id, { title: 'Other' });
    const at = '2026-10-19T12:00:00.000Z';
    for (const id of ['tie-a', 'tie-b', 'tie-c']) {
      await repos.events.append({
        id,
        at,
        threadId: thread.id,
        runId: run.id,
        type: 'message.delta',
        messageId: 'm1',
        delta: id,
      });
    }
    await repos.events.append({ id: 'later', at: '2026-10-19T12:00:01.000Z', threadId: thread.id, type: 'run.completed' });
    await repos.events.append({ id: 'other-thread', at, threadId: other.id, type: 'run.completed' });

    expect((await repos.events.listAfterEvent('tie-a'))?.map((event) => event.id)).toEqual([
      'tie-b',
      'tie-c',
      'other-thread',
      'later',
    ]);
    expect((await repos.events.listAfterEvent('tie-a', { threadId: thread.id }))?.map((event) => event.id)).toEqual([
      'tie-b',
      'tie-c',
      'later',
    ]);
    expect((await repos.events.listAfterEvent('tie-c'))?.map((event) => event.id)).toEqual(['other-thread', 'later']);
    expect((await repos.events.listAfterEvent('tie-a', { limit: 1 }))?.map((event) => event.id)).toEqual(['tie-b']);
    expect(await repos.events.listAfterEvent('missing')).toBeUndefined();
  });

  it('returns undefined for a cursor that is not in the thread', async () => {
    const { bot, thread } = await seed();
    const other = await repos.threads.create(bot.id, { title: 'Other' });
    await repos.events.append({ id: 'evt-x', at: '2026-10-19T12:00:00.000Z', threadId: other.id, type: 'run.completed' });

    expect(await repos.events.listAfter(thread.id, 'evt-x')).toBeUndefined();
    expect(await repos.events.listAfter(thread.id, 'evt-missing')).toBeUndefined();
  });
});

describe('task work run', () => {
  it('stores the run doing a task, clears it when the run is deleted, and accepts it on update', async () => {
    const { bot, thread, run } = await seed();
    const task = await repos.tasks.create({ title: 'Ship', assigneeBotId: bot.id, threadId: thread.id });
    expect(task.workRunId).toBeUndefined();

    const working = await repos.tasks.update(task.id, { status: 'in_progress', workRunId: run.id });
    expect(working).toMatchObject({ status: 'in_progress', workRunId: run.id });
    expect((await repos.tasks.get(task.id))?.workRunId).toBe(run.id);

    await handle.client.execute({ sql: 'DELETE FROM runs WHERE id = ?', args: [run.id] });
    const orphaned = await repos.tasks.get(task.id);
    expect(orphaned?.status).toBe('in_progress');
    expect(orphaned?.workRunId).toBeUndefined();
  });
});

describe('bot team budget', () => {
  it('stores a team budget and clears it with null', async () => {
    const bot = await repos.bots.create({ name: 'Onça', job: 'Lead', teamBudgetUsd: 4.5 });
    expect(bot.teamBudgetUsd).toBe(4.5);
    expect((await repos.bots.get(bot.id))?.teamBudgetUsd).toBe(4.5);

    const cleared = await repos.bots.update(bot.id, { teamBudgetUsd: null });
    expect(cleared?.teamBudgetUsd).toBeUndefined();
    expect((await repos.bots.get(bot.id))?.teamBudgetUsd).toBeUndefined();
  });
});

describe('mcp servers', () => {
  it('creates a stdio server with defaults and reads it back', async () => {
    const server = await repos.mcpServers.create({ name: 'tools', command: 'npx' });
    expect(server).toMatchObject({
      name: 'tools',
      transport: 'stdio',
      command: 'npx',
      args: [],
      env: {},
      enabled: true,
    });
    expect(server.url).toBeUndefined();
    expect(await repos.mcpServers.get(server.id)).toEqual(server);
    expect(await repos.mcpServers.list()).toEqual([server]);
  });

  it('stores args, env secret references and an http url', async () => {
    const stdio = await repos.mcpServers.create({
      name: 'with-env',
      command: 'node',
      args: ['server.mjs', '--stdio'],
      env: { LOG_LEVEL: 'info', API_KEY: 'secret://mcp-key' },
    });
    expect((await repos.mcpServers.get(stdio.id))?.env).toEqual({
      LOG_LEVEL: 'info',
      API_KEY: 'secret://mcp-key',
    });
    expect((await repos.mcpServers.get(stdio.id))?.args).toEqual(['server.mjs', '--stdio']);

    const web = await repos.mcpServers.create({ name: 'remote', transport: 'http', url: 'http://127.0.0.1:3400/mcp' });
    expect(web).toMatchObject({ transport: 'http', url: 'http://127.0.0.1:3400/mcp', args: [], env: {} });
    expect(web.command).toBeUndefined();
  });

  it('lists only enabled servers for runs', async () => {
    const on = await repos.mcpServers.create({ name: 'on', command: 'node' });
    const off = await repos.mcpServers.create({ name: 'off', command: 'node', enabled: false });
    expect((await repos.mcpServers.listEnabled()).map((server) => server.id)).toEqual([on.id]);

    expect((await repos.mcpServers.update(off.id, { enabled: true }))?.enabled).toBe(true);
    expect((await repos.mcpServers.listEnabled()).map((server) => server.id).sort()).toEqual([on.id, off.id].sort());
  });

  it('keeps names unique', async () => {
    await repos.mcpServers.create({ name: 'once', command: 'node' });
    await expect(repos.mcpServers.create({ name: 'once', command: 'node' })).rejects.toThrow();
  });

  it('merges an update and validates the resulting transport fields', async () => {
    const server = await repos.mcpServers.create({ name: 'renamable', command: 'node' });
    const updated = await repos.mcpServers.update(server.id, { name: 'renamed', enabled: false });
    expect(updated).toMatchObject({ name: 'renamed', enabled: false, command: 'node' });
    expect((updated?.updatedAt ?? '') >= server.updatedAt).toBe(true);

    const switched = await repos.mcpServers.update(server.id, { transport: 'http', url: 'http://localhost:9000/mcp' });
    expect(switched).toMatchObject({ name: 'renamed', command: 'node', transport: 'http', url: 'http://localhost:9000/mcp' });

    await expect(repos.mcpServers.update(server.id, { transport: 'stdio' })).resolves.toMatchObject({ transport: 'stdio' });
    const broken = await repos.mcpServers.create({ name: 'broken', transport: 'http', url: 'https://example.com/mcp' });
    await expect(repos.mcpServers.update(broken.id, { transport: 'stdio' })).rejects.toThrow(/command/);
    expect(await repos.mcpServers.update('missing', { name: 'x' })).toBeUndefined();
  });

  it('removes a server and reports missing ids', async () => {
    const server = await repos.mcpServers.create({ name: 'gone', command: 'node' });
    expect(await repos.mcpServers.remove(server.id)).toBe(true);
    expect(await repos.mcpServers.remove(server.id)).toBe(false);
    expect(await repos.mcpServers.get(server.id)).toBeUndefined();
  });
});

describe('attachments', () => {
  function record(overrides: Record<string, unknown> = {}) {
    return {
      name: 'notes.txt',
      mimeType: 'text/plain',
      size: 5,
      sha256: 'a'.repeat(64),
      threadId: '',
      ...overrides,
    };
  }

  it('stores metadata, derives the kind, lists by thread and id, and links to a message', async () => {
    const { thread } = await seed();
    const first = await repos.attachments.create(record({ threadId: thread.id }));
    expect(first).toMatchObject({ name: 'notes.txt', mimeType: 'text/plain', size: 5, kind: 'file' });
    expect(first.messageId).toBeUndefined();

    const image = await repos.attachments.create(
      record({ name: 'shot.png', mimeType: 'image/png', size: 10, sha256: 'b'.repeat(64), threadId: thread.id }),
    );
    expect(image.kind).toBe('image');

    expect(await repos.attachments.get(first.id)).toEqual(first);
    expect((await repos.attachments.listByThread(thread.id)).map((item) => item.id)).toEqual([first.id, image.id]);
    expect((await repos.attachments.listByIds([image.id, 'missing', first.id])).map((item) => item.id)).toEqual([
      first.id,
      image.id,
    ]);

    const message = await repos.messages.create({ threadId: thread.id, role: 'user', content: 'See files' });
    await repos.attachments.linkToMessage([first.id, image.id], message.id);
    expect((await repos.attachments.get(first.id))?.messageId).toBe(message.id);
    expect((await repos.messages.get(message.id))?.attachments?.map((item) => item.id)).toEqual([first.id, image.id]);
    expect(
      (await repos.messages.listByThread(thread.id)).find((item) => item.id === message.id)?.attachments,
    ).toHaveLength(2);
  });

  it('lists every stored id for the boot sweep', async () => {
    const { thread } = await seed();
    const first = await repos.attachments.create(record({ threadId: thread.id }));
    const second = await repos.attachments.create(
      record({ name: 'shot.png', mimeType: 'image/png', sha256: 'b'.repeat(64), threadId: thread.id }),
    );
    expect(await repos.attachments.listIds()).toEqual([first.id, second.id].sort());
  });

  it('leaves a message without attachments untouched and removes metadata', async () => {
    const { thread } = await seed();
    const plain = await repos.messages.create({ threadId: thread.id, role: 'user', content: 'hi' });
    expect(await repos.messages.get(plain.id)).not.toHaveProperty('attachments');

    const attachment = await repos.attachments.create(record({ threadId: thread.id }));
    expect(await repos.attachments.remove(attachment.id)).toBe(true);
    expect(await repos.attachments.remove(attachment.id)).toBe(false);
    expect(await repos.attachments.get(attachment.id)).toBeUndefined();
  });

  it('unlinks an attachment when its message is deleted but keeps the metadata', async () => {
    const { thread } = await seed();
    const attachment = await repos.attachments.create(record({ threadId: thread.id }));
    const message = await repos.messages.create({ threadId: thread.id, role: 'user', content: 'See file' });
    await repos.attachments.linkToMessage([attachment.id], message.id);
    await handle.client.execute({ sql: 'DELETE FROM messages WHERE id = ?', args: [message.id] });
    expect((await repos.attachments.get(attachment.id))?.messageId).toBeUndefined();
  });
});

describe('notifications', () => {
  async function notification(
    botId: string,
    threadId: string,
    overrides: { kind?: 'approval' | 'finished' | 'failed'; createdAt?: string; title?: string } = {},
  ) {
    return repos.notifications.create({
      botId,
      threadId,
      kind: overrides.kind ?? 'finished',
      title: overrides.title ?? '"Ada" finished',
      body: 'Done.',
      ...(overrides.createdAt === undefined ? {} : { createdAt: overrides.createdAt }),
    });
  }

  it('creates unread records and lists them newest first', async () => {
    const { bot, thread } = await seed();
    const first = await notification(bot.id, thread.id, { createdAt: '2026-10-20T10:00:00.000Z' });
    const second = await notification(bot.id, thread.id, {
      kind: 'approval',
      createdAt: '2026-10-20T11:00:00.000Z',
      title: '"Ada" needs your approval',
    });
    expect(first.readAt).toBeUndefined();

    const listed = await repos.notifications.list();
    expect(listed.map((item) => item.id)).toEqual([second.id, first.id]);
    expect((await repos.notifications.countUnread())).toBe(2);
  });

  it('filters by unread and bot, and clamps the limit', async () => {
    const { bot, thread } = await seed();
    const other = await repos.bots.create({ name: 'Bo', job: 'x' });
    const otherThread = await repos.threads.create(other.id);
    const first = await notification(bot.id, thread.id, { createdAt: '2026-10-20T10:00:00.000Z' });
    const readOne = await notification(bot.id, thread.id, { createdAt: '2026-10-20T11:00:00.000Z' });
    const otherOne = await notification(other.id, otherThread.id, { createdAt: '2026-10-20T12:00:00.000Z' });
    await repos.notifications.markRead([readOne.id]);

    expect((await repos.notifications.list()).map((item) => item.id)).toHaveLength(3);
    expect((await repos.notifications.list({ unread: true })).map((item) => item.id)).toEqual([otherOne.id, first.id]);
    expect((await repos.notifications.list({ unread: true })).every((item) => item.readAt === undefined)).toBe(true);
    expect((await repos.notifications.list({ botId: other.id })).map((item) => item.botId)).toEqual([other.id]);
    expect(await repos.notifications.list({ limit: 2 })).toHaveLength(2);
    expect(await repos.notifications.list({ limit: 500 })).toHaveLength(3);
    expect(await repos.notifications.list({ limit: 0 })).toHaveLength(1);
  });

  it('marks all unread or only the given ids read, counting what changed', async () => {
    const { bot, thread } = await seed();
    const first = await notification(bot.id, thread.id, { createdAt: '2026-10-20T10:00:00.000Z' });
    const second = await notification(bot.id, thread.id, { createdAt: '2026-10-20T11:00:00.000Z' });

    expect(await repos.notifications.markRead([first.id])).toBe(1);
    expect((await repos.notifications.list({ unread: true })).map((item) => item.id)).toEqual([second.id]);
    expect(await repos.notifications.markRead([first.id])).toBe(0);
    expect(await repos.notifications.markRead()).toBe(1);
    expect(await repos.notifications.countUnread()).toBe(0);
    expect(await repos.notifications.markRead()).toBe(0);
    expect(await repos.notifications.markRead([])).toBe(0);
  });

  it('removes one record or everything older than a date', async () => {
    const { bot, thread } = await seed();
    const old = await notification(bot.id, thread.id, { createdAt: '2026-09-01T10:00:00.000Z' });
    const recent = await notification(bot.id, thread.id, { createdAt: '2026-10-20T10:00:00.000Z' });

    expect(await repos.notifications.remove(old.id)).toBe(true);
    expect(await repos.notifications.remove(old.id)).toBe(false);
    expect(await repos.notifications.pruneBefore('2026-10-01T00:00:00.000Z')).toBe(0);
    const stillThere = await notification(bot.id, thread.id, { createdAt: '2026-09-15T10:00:00.000Z' });
    expect(await repos.notifications.pruneBefore('2026-10-01T00:00:00.000Z')).toBe(1);
    expect((await repos.notifications.list()).map((item) => item.id)).toEqual([recent.id]);
    expect(stillThere.createdAt).toBe('2026-09-15T10:00:00.000Z');
  });

  it('cascades notifications away with their bot and thread', async () => {
    const { bot, thread } = await seed();
    await notification(bot.id, thread.id);
    expect(await repos.bots.remove(bot.id)).toBe(true);
    expect(await repos.notifications.list()).toEqual([]);
  });
});

describe('settings', () => {
  /** A tiny parser standing in for a schema: any object with `parse` works, including zod schemas. */
  function parser<T>(accept: (value: unknown) => value is T): { parse(value: unknown): T } {
    return {
      parse(value: unknown): T {
        if (!accept(value)) throw new Error('invalid value');
        return value;
      },
    };
  }

  it('stores any JSON value under a key and reads it back through its schema', async () => {
    expect(await repos.settings.get('voice', parser((value): value is { provider: string } => {
      return typeof value === 'object' && value !== null && 'provider' in value;
    }))).toBeUndefined();

    await repos.settings.set('voice', { provider: 'system', voice: '' });
    expect(
      await repos.settings.get('voice', parser((value): value is { provider: string; voice: string } => {
        return typeof value === 'object' && value !== null && 'provider' in value && 'voice' in value;
      })),
    ).toEqual({ provider: 'system', voice: '' });

    await repos.settings.set('voice', { provider: 'openai-compatible', model: 'tts-1' });
    expect(
      await repos.settings.get('voice', parser((value): value is { provider: string } => {
        return typeof value === 'object' && value !== null && 'provider' in value;
      })),
    ).toEqual({ provider: 'openai-compatible', model: 'tts-1' });
  });

  it('treats a stored value that no longer parses as absent', async () => {
    await repos.settings.set('count', 'not a number');
    expect(await repos.settings.get('count', parser((value): value is number => typeof value === 'number'))).toBeUndefined();
    await repos.settings.set('count', 3);
    expect(await repos.settings.get('count', parser((value): value is number => typeof value === 'number'))).toBe(3);
  });

  it('removes a key and reports the change', async () => {
    await repos.settings.set('voice', { provider: 'system' });
    expect(await repos.settings.remove('voice')).toBe(true);
    expect(await repos.settings.remove('voice')).toBe(false);
    expect(await repos.settings.get('voice', parser((value): value is unknown => value !== undefined))).toBeUndefined();
  });

  it('keeps keys independent', async () => {
    await repos.settings.set('voice', { provider: 'system' });
    await repos.settings.set('other', [1, 2, 3]);
    expect(
      await repos.settings.get('other', parser((value): value is number[] => Array.isArray(value) && value.length === 3)),
    ).toEqual([1, 2, 3]);
    expect(
      await repos.settings.get('voice', parser((value): value is { provider: string } => typeof value === 'object' && value !== null && 'provider' in value)),
    ).toEqual({ provider: 'system' });
  });
});

describe('bot presets', () => {
  it('creates a preset with defaults and reads it back', async () => {
    const created = await repos.botPresets.create({ name: 'Researcher', job: 'Reads papers' });
    expect(created).toMatchObject({ name: 'Researcher', job: 'Reads papers', instructions: '' });
    expect(created.avatar).toBeUndefined();
    expect(await repos.botPresets.get(created.id)).toEqual(created);

    const dressed = await repos.botPresets.create({
      name: 'Ops',
      job: 'Keeps things up',
      instructions: 'Be terse.',
      avatar: 'onca:blue',
    });
    expect(dressed).toMatchObject({ instructions: 'Be terse.', avatar: 'onca:blue' });
  });

  it('lists by name, allows duplicate names, updates fields and removes', async () => {
    const zeta = await repos.botPresets.create({ name: 'Zeta', job: 'j' });
    const alpha = await repos.botPresets.create({ name: 'Alpha', job: 'j' });
    const alphaAgain = await repos.botPresets.create({ name: 'Alpha', job: 'j2' });
    expect((await repos.botPresets.list()).map((preset) => preset.name)).toEqual(['Alpha', 'Alpha', 'Zeta']);

    const updated = await repos.botPresets.update(alpha.id, {
      name: 'Renamed',
      instructions: 'Say less.',
      avatar: 'boto:black',
    });
    expect(updated).toMatchObject({ name: 'Renamed', job: 'j', instructions: 'Say less.', avatar: 'boto:black' });
    expect(updated?.updatedAt).toBeDefined();
    expect((await repos.botPresets.get(alpha.id))?.name).toBe('Renamed');

    expect(await repos.botPresets.remove(zeta.id)).toBe(true);
    expect(await repos.botPresets.remove(zeta.id)).toBe(false);
    expect(await repos.botPresets.get(zeta.id)).toBeUndefined();
    expect(await repos.botPresets.update(alphaAgain.id, {})).toMatchObject({ name: 'Alpha', job: 'j2' });
  });

  it('refuses a preset outside the schemas', async () => {
    await expect(repos.botPresets.create({ name: '', job: 'j' })).rejects.toThrow();
    await expect(repos.botPresets.create({ name: 'X', job: 'j', avatar: 'ada.png' })).rejects.toThrow();
    await expect(repos.botPresets.update('missing', { name: 'X' })).resolves.toBeUndefined();
  });
});

describe('approval decision log', () => {
  async function resolvedApproval(options: {
    botId?: string;
    threadId?: string;
    runId?: string;
    decision?: 'allow_once' | 'allow_always' | 'deny';
    tool?: string;
    resolvedAt?: string;
  } = {}) {
    const { bot, thread, run } = await seed();
    const approval = await repos.approvals.create({
      runId: options.runId ?? run.id,
      threadId: options.threadId ?? thread.id,
      botId: options.botId ?? bot.id,
      kind: 'send',
      tool: options.tool ?? 'send_email',
      summary: 'Send the invoice',
      args: { to: 'ada@example.com' },
    });
    await repos.approvals.resolve(approval.id, { decision: options.decision ?? 'allow_once' });
    if (options.resolvedAt !== undefined) {
      await handle.client.execute({
        sql: 'UPDATE approvals SET resolved_at = ? WHERE id = ?',
        args: [options.resolvedAt, approval.id],
      });
    }
    return (await repos.approvals.get(approval.id))!;
  }

  it('returns only resolved decisions, newest first, with their args intact', async () => {
    const pending = await repos.approvals.create({
      runId: (await seed()).run.id,
      threadId: (await seed()).thread.id,
      botId: (await seed()).bot.id,
      kind: 'send',
      tool: 'send_email',
      summary: 'Pending',
      args: {},
    });
    const older = await resolvedApproval({ resolvedAt: '2026-10-20T10:00:00.000Z' });
    const newer = await resolvedApproval({ resolvedAt: '2026-10-20T11:00:00.000Z', decision: 'deny' });

    const decisions = await repos.approvals.listDecisions();
    expect(decisions.map((row) => row.id)).toEqual([newer.id, older.id]);
    expect(decisions.some((row) => row.id === pending.id)).toBe(false);
    expect(decisions[1]?.args).toEqual({ to: 'ada@example.com' });
    expect(decisions[1]?.decision).toBe('allow_once');
    expect(decisions[0]?.decision).toBe('deny');
  });

  it('breaks ties on the same resolvedAt by insertion order, newest first', async () => {
    const first = await resolvedApproval({ resolvedAt: '2026-10-20T10:00:00.000Z' });
    const second = await resolvedApproval({ resolvedAt: '2026-10-20T10:00:00.000Z' });
    expect((await repos.approvals.listDecisions()).map((row) => row.id)).toEqual([second.id, first.id]);
  });

  it('filters by the half-open range, bot and decision', async () => {
    const before = await resolvedApproval({ resolvedAt: '2026-10-01T00:00:00.000Z' });
    const inRange = await resolvedApproval({ resolvedAt: '2026-10-15T00:00:00.000Z', decision: 'deny' });
    const after = await resolvedApproval({ resolvedAt: '2026-10-20T00:00:00.000Z' });

    const ranged = await repos.approvals.listDecisions({
      from: '2026-10-15T00:00:00.000Z',
      to: '2026-10-20T00:00:00.000Z',
    });
    expect(ranged.map((row) => row.id)).toEqual([inRange.id]);
    expect(ranged.some((row) => row.id === before.id || row.id === after.id)).toBe(false);

    const denied = await repos.approvals.listDecisions({ decision: 'deny' });
    expect(denied.map((row) => row.id)).toEqual([inRange.id]);

    const other = await seed();
    await resolvedApproval({ botId: other.bot.id, threadId: other.thread.id, runId: other.run.id });
    expect((await repos.approvals.listDecisions({ botId: other.bot.id })).map((row) => row.botId)).toEqual([
      other.bot.id,
    ]);
  });

  it('applies the limit in SQL and ignores rows without a decision or a resolution time', async () => {
    for (const day of ['01', '02', '03']) await resolvedApproval({ resolvedAt: `2026-10-${day}T00:00:00.000Z` });
    expect(await repos.approvals.listDecisions({ limit: 2 })).toHaveLength(2);
    expect(await repos.approvals.listDecisions()).toHaveLength(3);

    const { bot, thread, run } = await seed();
    const blank = await repos.approvals.create({
      runId: run.id,
      threadId: thread.id,
      botId: bot.id,
      kind: 'send',
      tool: 'send_email',
      summary: 'No decision',
      args: {},
    });
    await handle.client.execute({
      sql: "UPDATE approvals SET status = 'allowed', decision = NULL, resolved_at = ? WHERE id = ?",
      args: ['2026-10-04T00:00:00.000Z', blank.id],
    });
    const unresolvable = await repos.approvals.create({
      runId: run.id,
      threadId: thread.id,
      botId: bot.id,
      kind: 'send',
      tool: 'send_email',
      summary: 'No time',
      args: {},
    });
    await handle.client.execute({
      sql: "UPDATE approvals SET status = 'allowed', decision = 'allow_once', resolved_at = NULL WHERE id = ?",
      args: [unresolvable.id],
    });

    const decisions = await repos.approvals.listDecisions();
    expect(decisions).toHaveLength(3);
    expect(decisions.some((row) => row.id === blank.id || row.id === unresolvable.id)).toBe(false);
  });
});

describe('room batons', () => {
  it('stores, replaces and clears the baton', async () => {
    const { bot, thread } = await seed();
    expect(await repos.roomBatons.get(thread.id)).toBeUndefined();

    await repos.roomBatons.set(thread.id, bot.id);
    expect(await repos.roomBatons.get(thread.id)).toBe(bot.id);

    const grace = await repos.bots.create({ name: 'Grace', job: 'Ops' });
    await repos.roomBatons.set(thread.id, grace.id);
    expect(await repos.roomBatons.get(thread.id)).toBe(grace.id);

    expect(await repos.roomBatons.clear(thread.id)).toBe(true);
    expect(await repos.roomBatons.clear(thread.id)).toBe(false);
    expect(await repos.roomBatons.get(thread.id)).toBeUndefined();
  });

  it('removes the baton with its thread', async () => {
    const { bot, thread } = await seed();
    await repos.roomBatons.set(thread.id, bot.id);
    expect(await repos.threads.remove(thread.id)).toBe(true);
    expect(await repos.roomBatons.get(thread.id)).toBeUndefined();
  });
});

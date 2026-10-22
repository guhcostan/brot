import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SavedLogin } from '@brot/protocol';
import { hashDeviceToken } from '../auth';
import { call, createTestContext, type TestContext } from '../testing';
import { savedLoginSecretNames } from '../vault';

const VALUES = {
  username: 'ada@example.com',
  password: 'correct horse battery staple',
  totp: 'JBSWY3DPEHPK3PXP',
};

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestContext({ computers: {} });
});

afterEach(async () => {
  await ctx.close();
});

function input(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { name: 'GitHub work', host: 'github.com', username: VALUES.username, password: VALUES.password, ...overrides };
}

async function createLogin(overrides: Record<string, unknown> = {}): Promise<SavedLogin> {
  const response = await call(ctx.app, 'POST', '/api/logins', input(overrides));
  expect(response.status).toBe(201);
  return (await response.json()) as SavedLogin;
}

async function viewerToken(): Promise<Record<string, string>> {
  const token = randomBytes(24).toString('base64url');
  await ctx.services.repos.devices.create({
    name: 'Phone',
    role: 'viewer',
    publicKey: 'test-public-key',
    tokenHash: hashDeviceToken(token),
  });
  return { authorization: `Bearer ${token}` };
}

describe('saved login routes', () => {
  it('creates a login and lists it without ever returning a value', async () => {
    const created = await createLogin({ totp: VALUES.totp, label: 'Work account' });
    expect(created).toMatchObject({ name: 'GitHub work', host: 'github.com', hasTotp: true, label: 'Work account' });

    const names = savedLoginSecretNames(created.id);
    const resolved = await Promise.all([
      ctx.services.vault.resolveRef(`secret://${names.username}`),
      ctx.services.vault.resolveRef(`secret://${names.password}`),
      ctx.services.vault.resolveRef(`secret://${names.totp}`),
    ]);
    expect(resolved).toEqual([VALUES.username, VALUES.password, VALUES.totp]);

    const response = await call(ctx.app, 'GET', '/api/logins');
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual([created]);
    expect(text).not.toContain(VALUES.username);
    expect(text).not.toContain(VALUES.password);
    expect(text).not.toContain(VALUES.totp);
    expect(text).not.toContain('username_secret');
  });

  it('rejects a duplicate name and a malformed host with 400 issues', async () => {
    await createLogin();
    const duplicate = await call(ctx.app, 'POST', '/api/logins', input({ label: 'second' }));
    expect(duplicate.status).toBe(400);
    expect(await duplicate.json()).toMatchObject({ error: 'Invalid request', issues: [{ path: ['name'] }] });

    for (const host of ['https://github.com', 'github.com/login', 'github.com:443', 'x']) {
      const bad = await call(ctx.app, 'POST', '/api/logins', input({ name: `Login ${host}`, host }));
      expect(bad.status).toBe(400);
      expect(await bad.json()).toMatchObject({ error: 'Invalid request', issues: [{ path: ['host'] }] });
    }
  });

  it('renames, re-seals values, and clears the one-time code', async () => {
    const created = await createLogin({ totp: VALUES.totp });
    const renamed = await call(ctx.app, 'PATCH', `/api/logins/${created.id}`, {
      name: 'GitHub personal',
      host: 'github.example',
      username: 'grace@example.com',
      password: 'new password',
      totp: null,
    });
    expect(renamed.status).toBe(200);
    const updated = (await renamed.json()) as SavedLogin;
    expect(updated).toMatchObject({ name: 'GitHub personal', host: 'github.example', hasTotp: false });

    const names = savedLoginSecretNames(created.id);
    expect(await ctx.services.vault.resolveRef(`secret://${names.username}`)).toBe('grace@example.com');
    expect(await ctx.services.vault.resolveRef(`secret://${names.password}`)).toBe('new password');
    expect(await ctx.services.vault.has(names.totp)).toBe(false);

    const other = await createLogin({ name: 'Other' });
    const clash = await call(ctx.app, 'PATCH', `/api/logins/${created.id}`, { name: other.name });
    expect(clash.status).toBe(400);
    expect(await clash.json()).toMatchObject({ issues: [{ path: ['name'] }] });

    expect((await call(ctx.app, 'PATCH', '/api/logins/missing', { name: 'x' })).status).toBe(404);
  });

  it('deletes the row and its vault values', async () => {
    const created = await createLogin({ totp: VALUES.totp });
    const removed = await call(ctx.app, 'DELETE', `/api/logins/${created.id}`);
    expect(removed.status).toBe(204);
    expect(await ctx.services.repos.savedLogins.get(created.id)).toBeUndefined();
    expect(await ctx.services.vault.list()).toEqual([]);
    expect((await call(ctx.app, 'DELETE', `/api/logins/${created.id}`)).status).toBe(404);
  });

  it('lets a viewer read but not write, like every state-changing route', async () => {
    await createLogin();
    const auth = await viewerToken();
    expect((await call(ctx.remote, 'GET', '/api/logins', undefined, auth)).status).toBe(200);
    expect((await call(ctx.remote, 'POST', '/api/logins', input({ name: 'Other' }), auth)).status).toBe(403);
    expect((await call(ctx.remote, 'POST', '/api/logins', input({ name: 'Other' }))).status).toBe(401);
  });
});

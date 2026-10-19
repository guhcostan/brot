import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { call, createTestContext, type TestContext } from './testing';

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  await ctx.close();
});

const SECRET = 'hunter2-SECRET-value';

describe('vault', () => {
  it('stores, lists and deletes secrets and never returns a value', async () => {
    const put = await call(ctx.app, 'PUT', '/api/secrets/gmail-app-password', { value: SECRET });
    expect(put.status).toBe(200);
    expect(await put.text()).not.toContain(SECRET);

    const listed = await call(ctx.app, 'GET', '/api/secrets');
    const listedText = await listed.text();
    expect(JSON.parse(listedText)).toEqual(['gmail-app-password']);
    expect(listedText).not.toContain(SECRET);

    expect(await ctx.services.vault.resolveRef('secret://gmail-app-password')).toBe(SECRET);
    expect(await ctx.services.vault.has('gmail-app-password')).toBe(true);

    expect((await call(ctx.app, 'DELETE', '/api/secrets/gmail-app-password')).status).toBe(204);
    expect(await ctx.services.vault.has('gmail-app-password')).toBe(false);
    expect((await call(ctx.app, 'DELETE', '/api/secrets/gmail-app-password')).status).toBe(404);
  });

  it('keeps plaintext off disk and the key file private', async () => {
    await call(ctx.app, 'PUT', '/api/secrets/api-token', { value: SECRET });

    const onDisk = await readFile(join(ctx.dir, 'vault.json'), 'utf8');
    expect(onDisk).not.toContain(SECRET);
    const key = await readFile(join(ctx.dir, 'vault.key'));
    expect(key.length).toBe(32);
    expect((await stat(join(ctx.dir, 'vault.key'))).mode & 0o777).toBe(0o600);
  });

  it('will not decrypt a value moved under another name', async () => {
    await call(ctx.app, 'PUT', '/api/secrets/alpha', { value: SECRET });
    const file = JSON.parse(await readFile(join(ctx.dir, 'vault.json'), 'utf8')) as {
      secrets: Record<string, unknown>;
    };
    file.secrets.beta = file.secrets.alpha;
    await writeFile(join(ctx.dir, 'vault.json'), JSON.stringify(file));

    await expect(ctx.services.vault.resolveRef('secret://beta')).rejects.toThrow();
    expect(await ctx.services.vault.resolveRef('secret://alpha')).toBe(SECRET);
  });

  it('rejects invalid names and empty values', async () => {
    expect((await call(ctx.app, 'PUT', '/api/secrets/bad%20name', { value: 'x' })).status).toBe(400);
    expect((await call(ctx.app, 'PUT', '/api/secrets/__proto__', { value: 'x' })).status).toBe(400);
    expect((await call(ctx.app, 'PUT', '/api/secrets/ok', { value: '' })).status).toBe(400);
    expect(await ctx.services.vault.resolveRef('not-a-ref')).toBeUndefined();
  });
});

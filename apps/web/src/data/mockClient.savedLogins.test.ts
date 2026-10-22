import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockClient } from './mockClient';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const base = { name: 'GitHub work', host: 'github.com', username: 'capivara', password: 'secret' };

describe('mock saved logins', () => {
  it('seeds two value-free logins with their TOTP flag', async () => {
    const client = createMockClient();
    const logins = await client.listSavedLogins();

    expect(logins.map((login) => login.name)).toEqual(['GitHub', 'X/Twitter']);
    expect(logins.find((login) => login.name === 'GitHub')).toMatchObject({ host: 'github.com', label: 'Personal account', hasTotp: true });
    expect(logins.find((login) => login.name === 'X/Twitter')).toMatchObject({ host: 'x.com', hasTotp: false });
    const serialized = JSON.stringify(logins);
    expect(serialized).not.toContain('password');
    expect(serialized).not.toContain('username');
    expect(serialized).not.toContain('totp');
  });

  it('creates logins with and without a TOTP secret and keeps names unique', async () => {
    const client = createMockClient();
    const plain = await client.createSavedLogin(base);
    expect(plain).toMatchObject({ name: 'GitHub work', host: 'github.com', hasTotp: false });
    expect(plain.label).toBeUndefined();

    const withTotp = await client.createSavedLogin({ ...base, name: 'GitLab', host: 'gitlab.com', totp: 'jbsw y3dp ehpk 3pxp', label: 'Work' });
    expect(withTotp).toMatchObject({ hasTotp: true, label: 'Work' });

    await expect(client.createSavedLogin(base)).rejects.toThrow('already exists');
  });

  it('updates partial fields and keeps or clears the TOTP secret', async () => {
    const client = createMockClient();
    const github = (await client.listSavedLogins()).find((login) => login.name === 'GitHub');
    if (!github) throw new Error('GitHub login missing');

    const renamed = await client.updateSavedLogin(github.id, { name: 'GitHub personal', username: 'new-user' });
    expect(renamed).toMatchObject({ name: 'GitHub personal', host: 'github.com', hasTotp: true, label: 'Personal account' });

    const withoutTotp = await client.updateSavedLogin(github.id, { totp: null, label: null });
    expect(withoutTotp.hasTotp).toBe(false);
    expect(withoutTotp.label).toBeUndefined();

    const relabeled = await client.updateSavedLogin(github.id, { label: 'Main', totp: 'JBSWY3DPEHPK3PXP' });
    expect(relabeled).toMatchObject({ label: 'Main', hasTotp: true });

    await expect(client.updateSavedLogin('nope', { name: 'x' })).rejects.toThrow();
    await expect(client.updateSavedLogin(github.id, { name: 'X/Twitter' })).rejects.toThrow('already exists');
  });

  it('deletes a login and forgets its values', async () => {
    const client = createMockClient();
    const x = (await client.listSavedLogins()).find((login) => login.name === 'X/Twitter');
    if (!x) throw new Error('X login missing');

    await client.deleteSavedLogin(x.id);
    expect((await client.listSavedLogins()).some((login) => login.id === x.id)).toBe(false);
    await expect(client.deleteSavedLogin(x.id)).rejects.toThrow();
  });
});

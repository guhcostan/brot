import { mkdtemp, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext } from '../testing';
import { createAttachmentStorage, type AttachmentStorage } from './storage';

let home: string;
let storage: AttachmentStorage;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'brot-attachments-'));
  storage = createAttachmentStorage({ home });
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe('attachment storage', () => {
  it('writes bytes atomically with mode 0600 and reads them back', async () => {
    const bytes = new TextEncoder().encode('hello attachment');
    await storage.write('att-1', bytes);

    expect(await storage.read('att-1')).toEqual(bytes);
    const info = await stat(join(home, 'attachments', 'att-1'));
    expect(info.mode & 0o777).toBe(0o600);
    const dir = await stat(join(home, 'attachments'));
    expect(dir.mode & 0o077).toBe(0);
    expect(await readdir(join(home, 'attachments'))).toEqual(['att-1']);
  });

  it('reads at most a prefix of the file', async () => {
    await storage.write('att-2', new TextEncoder().encode('abcdefghij'));
    expect(new TextDecoder().decode(await storage.readPrefix('att-2', 4))).toBe('abcd');
    expect(new TextDecoder().decode(await storage.readPrefix('att-2', 100))).toBe('abcdefghij');
    expect(await storage.readPrefix('att-2', 0)).toEqual(new Uint8Array());
  });

  it('returns undefined for a missing file and removes stored ones', async () => {
    expect(await storage.read('missing')).toBeUndefined();
    expect(await storage.readPrefix('missing', 10)).toBeUndefined();

    await storage.write('att-3', new Uint8Array([1, 2, 3]));
    await storage.remove('att-3');
    await storage.remove('att-3');
    expect(await storage.read('att-3')).toBeUndefined();
  });

  it('refuses an id that could leave the storage directory', async () => {
    await expect(storage.write('../escape', new Uint8Array([1]))).rejects.toThrow(/invalid attachment id/);
    await expect(storage.read('a/b')).rejects.toThrow(/invalid attachment id/);
    await expect(storage.readPrefix('..', 1)).rejects.toThrow(/invalid attachment id/);
  });
});

describe('sweeping orphaned files', () => {
  it('removes files with no stored id and keeps the referenced ones', async () => {
    await storage.write('att-keep', new TextEncoder().encode('keep'));
    await storage.write('att-orphan', new TextEncoder().encode('orphan'));

    expect(await storage.sweep(new Set(['att-keep']))).toEqual({ removed: 1 });
    expect(await storage.read('att-keep')).not.toBeUndefined();
    expect(await storage.read('att-orphan')).toBeUndefined();
    expect(await readdir(join(home, 'attachments'))).toEqual(['att-keep']);
  });

  it('is a no-op when the directory does not exist', async () => {
    const otherHome = await mkdtemp(join(tmpdir(), 'brot-attachments-empty-'));
    try {
      const empty = createAttachmentStorage({ home: otherHome });
      expect(await empty.sweep(new Set())).toEqual({ removed: 0 });
    } finally {
      await rm(otherHome, { recursive: true, force: true });
    }
  });

  it('leaves names that are not attachment ids alone', async () => {
    await storage.write('att-real', new TextEncoder().encode('real'));
    const dir = join(home, 'attachments');
    await writeFile(join(dir, 'notes.txt'), 'not an id');
    await writeFile(join(dir, '.att-real.tmp'), 'half written');

    expect(await storage.sweep(new Set())).toEqual({ removed: 1 });
    expect((await readdir(dir)).sort()).toEqual(['.att-real.tmp', 'notes.txt']);
  });

  it.skipIf(process.platform === 'win32')('never follows or removes symlinks', async () => {
    const outside = join(home, 'outside.txt');
    await writeFile(outside, 'outside');
    await storage.write('att-real', new TextEncoder().encode('real'));
    await symlink(outside, join(home, 'attachments', 'att-link'));

    expect(await storage.sweep(new Set(['att-real']))).toEqual({ removed: 0 });
    expect(await readdir(join(home, 'attachments'))).toEqual(expect.arrayContaining(['att-link', 'att-real']));
    expect(await readdir(home)).toContain('outside.txt');
    await rm(outside, { force: true });
  });
});

describe('orphans left by a deleted bot or thread', () => {
  it('removes the bytes of an attachment whose rows were cascaded away', async () => {
    const ctx = await createTestContext({ computers: {} });
    try {
      const bot = await ctx.services.repos.bots.create({ name: 'Ada', job: 'Researcher', engine: 'mock' });
      const thread = await ctx.services.repos.threads.create(bot.id, { title: 'Chat' });
      const bytes = new TextEncoder().encode('bye');
      const attachment = await ctx.services.repos.attachments.create({
        threadId: thread.id,
        name: 'bye.txt',
        mimeType: 'text/plain',
        size: bytes.byteLength,
        sha256: 'a'.repeat(64),
      });
      await ctx.services.attachments.write(attachment.id, bytes);

      expect(await ctx.services.repos.bots.remove(bot.id)).toBe(true);
      expect(await ctx.services.repos.attachments.get(attachment.id)).toBeUndefined();
      expect(await ctx.services.attachments.read(attachment.id)).not.toBeUndefined();

      const { removed } = await ctx.services.attachments.sweep(
        new Set(await ctx.services.repos.attachments.listIds()),
      );
      expect(removed).toBe(1);
      expect(await ctx.services.attachments.read(attachment.id)).toBeUndefined();
    } finally {
      await ctx.close();
    }
  });
});

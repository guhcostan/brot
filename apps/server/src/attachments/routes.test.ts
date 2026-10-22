import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ATTACHMENT_MAX_BYTES,
  type Attachment,
  type Bot,
  type CanonicalEvent,
  type Message,
  type Thread,
} from '@brot/protocol';
import { call, createTestContext, type TestContext } from '../testing';

let ctx: TestContext;
let bot: Bot;
let thread: Thread;

beforeEach(async () => {
  ctx = await createTestContext();
  bot = await ctx.services.repos.bots.create({ name: 'Ada', job: 'Researcher', engine: 'mock' });
  thread = await ctx.services.repos.threads.create(bot.id, { title: 'Chat' });
});

afterEach(async () => {
  await ctx.close();
});

function uploadBody(threadId: string, bytes: string | Uint8Array, name = 'notes.txt', type = 'text/plain'): FormData {
  const part: BlobPart = typeof bytes === 'string' ? bytes : new Uint8Array(bytes);
  const form = new FormData();
  form.set('threadId', threadId);
  form.set('file', new File([part], name, { type }));
  return form;
}

async function upload(
  body: FormData,
  app: TestContext['app'] = ctx.app,
): Promise<Response> {
  return app.request('/api/attachments', { method: 'POST', body });
}

async function uploadOne(
  overrides: { threadId?: string; bytes?: string; name?: string; type?: string } = {},
): Promise<Attachment> {
  const res = await upload(
    uploadBody(
      overrides.threadId ?? thread.id,
      overrides.bytes ?? 'hello notes',
      overrides.name ?? 'notes.txt',
      overrides.type ?? 'text/plain',
    ),
  );
  expect(res.status).toBe(201);
  return (await res.json()) as Attachment;
}

describe('POST /api/attachments', () => {
  it('stores a file and returns its metadata', async () => {
    const attachment = await uploadOne({ name: 'notes.txt', bytes: 'hello notes' });
    expect(attachment).toMatchObject({ name: 'notes.txt', mimeType: 'text/plain', size: 11, kind: 'file' });
    expect(attachment.messageId).toBeUndefined();
    expect(attachment.id).toEqual(expect.any(String));
  });

  it('marks an image as an image and sanitizes a path-like name for display', async () => {
    const image = await uploadOne({ name: 'shot.png', type: 'image/png', bytes: 'png' });
    expect(image.kind).toBe('image');

    const res = await upload(uploadBody(thread.id, 'text', '../../etc/passwd.txt'));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ name: 'passwd.txt' });
  });

  it('rejects a missing file, a missing thread, an unknown thread, a bad type and an oversize file', async () => {
    const noFile = new FormData();
    noFile.set('threadId', thread.id);
    expect((await upload(noFile)).status).toBe(400);

    const noThread = new FormData();
    noThread.set('file', new File(['x'], 'x.txt', { type: 'text/plain' }));
    expect((await upload(noThread)).status).toBe(400);

    const unknownThread = await upload(uploadBody('nope', 'x'));
    expect(unknownThread.status).toBe(400);
    expect(await unknownThread.json()).toEqual({ error: 'The thread does not exist' });

    const badType = await upload(uploadBody(thread.id, 'x', 'x.bin', 'application/octet-stream'));
    expect(badType.status).toBe(400);
    expect(((await badType.json()) as { error: string }).error).toMatch(/not an allowed type/);

    const oversize = await upload(
      uploadBody(thread.id, new Uint8Array(ATTACHMENT_MAX_BYTES + 1), 'big.pdf', 'application/pdf'),
    );
    expect(oversize.status).toBe(400);
    expect(((await oversize.json()) as { error: string }).error).toMatch(/limit/);
  });

  it('only accepts multipart on this route', async () => {
    const json = await call(ctx.app, 'POST', '/api/attachments', { threadId: thread.id });
    expect(json.status).toBe(415);

    const multipartMessage = new FormData();
    multipartMessage.set('content', 'hi');
    const res = await ctx.app.request(`/api/threads/${thread.id}/messages`, { method: 'POST', body: multipartMessage });
    expect(res.status).toBe(415);
  });

  it('requires device auth from a remote caller', async () => {
    const res = await upload(uploadBody(thread.id, 'hello'), ctx.remote);
    expect(res.status).toBe(401);
    expect(ctx.app.request).toBeDefined();
  });
});

describe('GET /api/attachments/:id', () => {
  it('returns the bytes with the stored type and an inline disposition', async () => {
    const attachment = await uploadOne({ bytes: 'hello notes' });
    const res = await call(ctx.app, 'GET', `/api/attachments/${attachment.id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/plain');
    expect(res.headers.get('content-disposition')).toContain('inline');
    expect(res.headers.get('content-disposition')).toContain('filename="notes.txt"');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await res.text()).toBe('hello notes');
  });

  it('answers 404 for an unknown attachment', async () => {
    expect((await call(ctx.app, 'GET', '/api/attachments/nope')).status).toBe(404);
  });
});

describe('DELETE /api/attachments/:id', () => {
  it('removes an unlinked attachment, idempotently reporting it missing afterwards', async () => {
    const attachment = await uploadOne();
    expect((await call(ctx.app, 'DELETE', `/api/attachments/${attachment.id}`)).status).toBe(204);
    expect((await call(ctx.app, 'GET', `/api/attachments/${attachment.id}`)).status).toBe(404);
    expect((await call(ctx.app, 'DELETE', `/api/attachments/${attachment.id}`)).status).toBe(404);
  });

  it('refuses to delete an attachment linked to a message, keeping it readable', async () => {
    const attachment = await uploadOne();
    await call(ctx.app, 'POST', `/api/threads/${thread.id}/messages`, {
      content: 'See attached',
      attachmentIds: [attachment.id],
    });

    const res = await call(ctx.app, 'DELETE', `/api/attachments/${attachment.id}`);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(/belongs to a message/);
    expect((await call(ctx.app, 'GET', `/api/attachments/${attachment.id}`)).status).toBe(200);
  });
});

describe('linking attachments to a message', () => {
  it('links uploads, returns the persisted message and includes them in later reads', async () => {
    const first = await uploadOne({ bytes: 'one', name: 'one.txt' });
    const second = await uploadOne({ bytes: 'two', name: 'two.txt' });

    const res = await call(ctx.app, 'POST', `/api/threads/${thread.id}/messages`, {
      content: 'See the files',
      attachmentIds: [first.id, second.id],
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { runId: string; message: Message };
    expect(body.message.attachments?.map((attachment) => attachment.id)).toEqual([first.id, second.id]);
    expect(body.message.attachments?.every((attachment) => attachment.messageId === body.message.id)).toBe(true);

    const messages = (await (await call(ctx.app, 'GET', `/api/threads/${thread.id}/messages`)).json()) as Message[];
    expect(messages.find((message) => message.id === body.message.id)?.attachments).toHaveLength(2);

    const events = (await (await call(ctx.app, 'GET', `/api/threads/${thread.id}/events`)).json()) as CanonicalEvent[];
    const completed = events.find(
      (event): event is Extract<CanonicalEvent, { type: 'message.completed' }> =>
        event.type === 'message.completed' && event.message.id === body.message.id,
    );
    expect(completed?.message.attachments).toHaveLength(2);
  });

  it('rejects an unknown attachment, another thread\'s attachment, an already linked one and more than ten', async () => {
    const otherThread = await ctx.services.repos.threads.create(bot.id, { title: 'Other' });
    const foreign = await uploadOne();
    const res = await call(ctx.app, 'POST', `/api/threads/${otherThread.id}/messages`, {
      content: 'Wrong thread',
      attachmentIds: [foreign.id],
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues: { path: string[]; message: string }[] };
    expect(body.error).toBe('Invalid request');
    expect(body.issues[0]?.message).toMatch(/another thread/);

    expect(
      (
        await call(ctx.app, 'POST', `/api/threads/${thread.id}/messages`, {
          content: 'Unknown',
          attachmentIds: ['nope'],
        })
      ).status,
    ).toBe(400);

    await call(ctx.app, 'POST', `/api/threads/${thread.id}/messages`, {
      content: 'First',
      attachmentIds: [foreign.id],
    });
    const again = await call(ctx.app, 'POST', `/api/threads/${thread.id}/messages`, {
      content: 'Again',
      attachmentIds: [foreign.id],
    });
    expect(again.status).toBe(400);
    expect(((await again.json()) as { issues: { message: string }[] }).issues[0]?.message).toMatch(/already linked/);

    const tooMany = await call(ctx.app, 'POST', `/api/threads/${thread.id}/messages`, {
      content: 'Too many',
      attachmentIds: Array.from({ length: 11 }, (_, index) => `att_${index}`),
    });
    expect(tooMany.status).toBe(400);
  });

  it('links attachments in a room message before its bots answer', async () => {
    const other = await ctx.services.repos.bots.create({ name: 'Bo', job: 'Helper', engine: 'mock' });
    const room = await ctx.services.repos.rooms.create({
      title: 'Launch',
      botIds: [bot.id, other.id],
      leadBotId: bot.id,
    });
    const attachment = await uploadOne({ threadId: room.id });

    const res = await call(ctx.app, 'POST', `/api/threads/${room.id}/messages`, {
      content: 'Look',
      attachmentIds: [attachment.id],
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { runId: string | null; message: Message };
    expect(body.message.attachments?.map((item) => item.id)).toEqual([attachment.id]);

    const messages = (await (await call(ctx.app, 'GET', `/api/threads/${room.id}/messages`)).json()) as Message[];
    expect(messages.find((message) => message.id === body.message.id)?.attachments).toHaveLength(1);
  });
});

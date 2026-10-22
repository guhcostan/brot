import type { Attachment, Message } from '@brot/protocol';
import { describe, expect, it } from 'vitest';
import { attachmentUrl } from './client';
import { createHttpClient, type FetchLike } from './httpClient';

const at = '2026-10-19T09:00:00.000Z';

const attachment: Attachment = {
  id: 'att_1',
  name: 'receipt.png',
  mimeType: 'image/png',
  size: 2048,
  kind: 'image',
  createdAt: at,
};

interface Call {
  method: string;
  path: string;
  headers: Headers;
  body: unknown;
}

function fakeFetch(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (input, init = {}) => {
    const url = new URL(input, 'http://brot.test');
    const call: Call = {
      method: init.method ?? 'GET',
      path: url.pathname,
      headers: new Headers(init.headers),
      body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body,
    };
    calls.push(call);
    // The event log route answers 404, so history falls back to the thread's records.
    if (/^\/api\/threads\/[^/]+\/events$/.test(call.path)) return json({ error: 'not found' }, 404);
    return respond(call);
  };
  return { fetch, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });

describe('attachment uploads', () => {
  it('posts a multipart body with the file and thread id, without a JSON content type', async () => {
    const { fetch, calls } = fakeFetch(() => json(attachment, 201));
    const client = createHttpClient({ fetch });

    await expect(client.uploadAttachment('thr_1', file)).resolves.toEqual(attachment);

    const call = calls[0];
    expect(call).toMatchObject({ method: 'POST', path: '/api/attachments' });
    expect(call?.headers.get('Content-Type')).toBeNull();
    const form = call?.body;
    expect(form).toBeInstanceOf(FormData);
    const fields = form as FormData;
    expect(fields.get('threadId')).toBe('thr_1');
    const sent = fields.get('file');
    expect(sent).toBeInstanceOf(File);
    expect((sent as File).name).toBe('notes.txt');
  });

  it('surfaces the server 400 message for a refused upload', async () => {
    const { fetch } = fakeFetch(() => json({ error: 'Attachment type is not allowed' }, 400));
    const client = createHttpClient({ fetch });

    await expect(client.uploadAttachment('thr_1', file)).rejects.toThrow('400 Attachment type is not allowed');
  });

  it('rejects an upload response that does not match the protocol', async () => {
    const { fetch } = fakeFetch(() => json({ id: 'att_1' }, 201));
    const client = createHttpClient({ fetch });

    await expect(client.uploadAttachment('thr_1', file)).rejects.toThrow();
  });

  it('deletes an unlinked upload and surfaces the 409 of a linked one', async () => {
    const { fetch, calls } = fakeFetch((call) =>
      call.path === '/api/attachments/att_linked' ? json({ error: 'This attachment belongs to a message and cannot be deleted' }, 409) : new Response(null, { status: 204 }),
    );
    const client = createHttpClient({ fetch });

    await expect(client.deleteAttachment('att_1')).resolves.toBeUndefined();
    await expect(client.deleteAttachment('att_linked')).rejects.toThrow('409 This attachment belongs to a message and cannot be deleted');
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'DELETE /api/attachments/att_1',
      'DELETE /api/attachments/att_linked',
    ]);
  });
});

describe('attachmentUrl', () => {
  it('builds the same-origin bytes URL and escapes the id', () => {
    expect(attachmentUrl('att_1')).toBe('/api/attachments/att_1');
    expect(attachmentUrl('a/b c')).toBe('/api/attachments/a%2Fb%20c');
  });
});

describe('messages with attachments', () => {
  it('sends attachmentIds with a DM message and a room message', async () => {
    const { fetch, calls } = fakeFetch(() => json({ runId: 'run_1' }, 202));
    const client = createHttpClient({ fetch });

    await client.postMessage('thr_1', { content: 'Receipts attached', attachmentIds: ['att_1', 'att_2'] });
    await client.postRoomMessage('room_1', { content: 'For the room', attachmentIds: ['att_3'] });

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'POST /api/threads/thr_1/messages',
      'POST /api/threads/room_1/messages',
    ]);
    expect(calls[0]?.body).toEqual({ content: 'Receipts attached', attachmentIds: ['att_1', 'att_2'] });
    expect(calls[1]?.body).toEqual({ content: 'For the room', attachmentIds: ['att_3'] });
  });

  it('fills replayed history messages with their attachments', async () => {
    const message: Message = {
      id: 'msg_1',
      threadId: 'thr_1',
      role: 'user',
      content: 'Receipts attached',
      createdAt: at,
      attachments: [attachment],
    };
    const { fetch } = fakeFetch((call) => {
      if (call.path === '/api/threads/thr_1/messages') return json([message]);
      return json([]);
    });
    const client = createHttpClient({ fetch });

    const events = await client.history('thr_1');
    const completed = events.find((event) => event.type === 'message.completed');
    expect(completed).toMatchObject({ message: { id: 'msg_1', attachments: [attachment] } });
  });
});

import { Attachment, CanonicalEvent, Message } from '@brot/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { foldEvents } from '../state/thread';
import { createMockClient } from './mockClient';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const notes = () => new File(['hello world'], 'notes.txt', { type: 'text/plain' });
const receipt = () => new File(['png-bytes'], 'receipt.png', { type: 'image/png' });

const threadOf = async (client: ReturnType<typeof createMockClient>, botId: string): Promise<string> => {
  const thread = (await client.listThreads(botId))[0];
  if (!thread) throw new Error(`${botId} has no DM thread`);
  return thread.id;
};

describe('mock attachments', () => {
  it('uploads metadata and classifies images and files', async () => {
    const client = createMockClient();
    const threadId = await threadOf(client, 'bot_capy');

    const image = await client.uploadAttachment(threadId, receipt());
    const text = await client.uploadAttachment(threadId, notes());

    expect(image).toMatchObject({ name: 'receipt.png', mimeType: 'image/png', kind: 'image', size: 9 });
    expect(text).toMatchObject({ name: 'notes.txt', kind: 'file' });
    expect(image.messageId).toBeUndefined();
    for (const attachment of [image, text]) expect(() => Attachment.parse(attachment)).not.toThrow();
    await expect(client.uploadAttachment('thread_missing', notes())).rejects.toThrow();
  });

  it('links uploaded attachments to the message it was posted with', async () => {
    const client = createMockClient();
    const threadId = await threadOf(client, 'bot_capy');
    const image = await client.uploadAttachment(threadId, receipt());
    const text = await client.uploadAttachment(threadId, notes());

    await client.postMessage(threadId, { content: 'Receipts attached', attachmentIds: [image.id, text.id] });
    await vi.runAllTimersAsync();

    const thread = foldEvents(await client.history(threadId));
    const message = thread.items.find((item) => item.kind === 'message' && item.content === 'Receipts attached');
    expect(message).toMatchObject({
      attachments: [
        { id: image.id, name: 'receipt.png', kind: 'image', messageId: expect.any(String) as unknown as string },
        { id: text.id, name: 'notes.txt', kind: 'file' },
      ],
    });
    for (const event of await client.history(threadId)) expect(() => CanonicalEvent.parse(event)).not.toThrow();
  });

  it('refuses to link an unknown, another-thread or already linked attachment', async () => {
    const client = createMockClient();
    const capy = await threadOf(client, 'bot_capy');
    const sol = await threadOf(client, 'bot_sol');
    const image = await client.uploadAttachment(capy, receipt());

    await expect(client.postMessage(capy, { content: 'Bad', attachmentIds: ['att_missing'] })).rejects.toThrow();
    await expect(client.postMessage(sol, { content: 'Bad', attachmentIds: [image.id] })).rejects.toThrow();
    await client.postMessage(capy, { content: 'First', attachmentIds: [image.id] });
    await expect(client.postMessage(capy, { content: 'Second', attachmentIds: [image.id] })).rejects.toThrow();
  });

  it('deletes an unlinked upload but never a linked one', async () => {
    const client = createMockClient();
    const threadId = await threadOf(client, 'bot_capy');
    const image = await client.uploadAttachment(threadId, receipt());
    const orphan = await client.uploadAttachment(threadId, notes());

    await expect(client.deleteAttachment(orphan.id)).resolves.toBeUndefined();
    await client.postMessage(threadId, { content: 'With receipt', attachmentIds: [image.id] });
    await expect(client.deleteAttachment(image.id)).rejects.toThrow('409');
    await expect(client.deleteAttachment('att_missing')).rejects.toThrow();
  });

  it('carries attachments on a room message', async () => {
    const client = createMockClient();
    const room = (await client.listRooms())[0];
    if (!room) throw new Error('no seeded room');
    const image = await client.uploadAttachment(room.thread.id, receipt());

    await client.postRoomMessage(room.thread.id, { content: 'For the room', attachmentIds: [image.id] });
    await vi.runAllTimersAsync();

    const thread = foldEvents(await client.roomHistory(room.thread.id));
    const message = thread.items.find(
      (item): item is Extract<(typeof thread.items)[number], { kind: 'message' }> =>
        item.kind === 'message' && item.content === 'For the room',
    );
    expect(message).toBeDefined();
    expect((message as { attachments?: Attachment[] }).attachments?.[0]?.id).toBe(image.id);
  });

  it('keeps a posted message protocol-valid with its attachments', async () => {
    const client = createMockClient();
    const threadId = await threadOf(client, 'bot_capy');
    const image = await client.uploadAttachment(threadId, receipt());
    await client.postMessage(threadId, { content: 'Valid', attachmentIds: [image.id] });
    const events = await client.history(threadId);
    const completed = events.find((event) => event.type === 'message.completed');
    if (completed?.type !== 'message.completed') throw new Error('no completed message');
    expect(() => Message.parse(completed.message)).not.toThrow();
  });
});

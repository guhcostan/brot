import type { Repos } from '@brot/db';
import type { Attachment } from '@brot/protocol';
import type { Context, Hono } from 'hono';
import type { AppEnv } from '../auth';
import { saveAttachmentUpload } from './upload';
import type { AttachmentStorage } from './storage';

export interface AttachmentRouteDeps {
  repos: Repos;
  storage: AttachmentStorage;
}

/** A header-safe display name: ASCII fallback plus the RFC 5987 UTF-8 form. */
function disposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(name).replace(/'/g, '%27');
  return `inline; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** Mounts attachment upload, download and delete under `/api/*`, so device auth and CORS apply. */
export function mountAttachmentRoutes(app: Hono<AppEnv>, deps: AttachmentRouteDeps): void {
  const { repos, storage } = deps;

  async function readMultipart(c: Context<AppEnv>): Promise<Record<string, unknown> | undefined> {
    try {
      return await c.req.parseBody();
    } catch {
      return undefined;
    }
  }

  app.post('/api/attachments', async (c) => {
    const contentType = c.req.header('content-type') ?? '';
    if (!/^multipart\/form-data\b/i.test(contentType)) {
      return c.json({ error: 'Attachments must be uploaded as multipart/form-data' }, 415);
    }
    const form = await readMultipart(c);
    if (form === undefined) return c.json({ error: 'The upload could not be read' }, 400);
    const file = form.file;
    const threadId = form.threadId;
    if (!(file instanceof File)) return c.json({ error: 'The upload needs a file field' }, 400);
    if (typeof threadId !== 'string' || threadId === '') {
      return c.json({ error: 'The upload needs a threadId field' }, 400);
    }
    const result = await saveAttachmentUpload(deps, { threadId, file });
    return result.ok ? c.json(result.attachment, 201) : c.json({ error: result.error }, 400);
  });

  app.get('/api/attachments/:id', async (c) => {
    const attachment: Attachment | undefined = await repos.attachments.get(c.req.param('id'));
    if (attachment === undefined) return c.json({ error: 'Attachment not found' }, 404);
    const bytes = await storage.read(attachment.id);
    if (bytes === undefined) return c.json({ error: 'Attachment not found' }, 404);
    const body = new Uint8Array(bytes.byteLength);
    body.set(bytes);
    return new Response(body, {
      headers: {
        'content-type': attachment.mimeType,
        'content-disposition': disposition(attachment.name),
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-store',
      },
    });
  });

  app.delete('/api/attachments/:id', async (c) => {
    const attachment = await repos.attachments.get(c.req.param('id'));
    if (attachment === undefined) return c.json({ error: 'Attachment not found' }, 404);
    if (attachment.messageId !== undefined) {
      return c.json({ error: 'This attachment belongs to a message and cannot be deleted' }, 409);
    }
    if (!(await repos.attachments.remove(attachment.id))) return c.json({ error: 'Attachment not found' }, 404);
    await storage.remove(attachment.id).catch(() => undefined);
    return c.body(null, 204);
  });
}

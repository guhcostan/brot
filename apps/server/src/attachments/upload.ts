import { createHash, randomUUID } from 'node:crypto';
import type { Repos } from '@brot/db';
import {
  ATTACHMENT_MAX_BYTES,
  isAllowedAttachmentMime,
  sanitizeAttachmentName,
  type Attachment,
} from '@brot/protocol';
import { formatAttachmentSize } from './context';
import type { AttachmentStorage } from './storage';

export interface AttachmentUpload {
  threadId: string;
  file: File;
}

export type AttachmentUploadOutcome = { ok: true; attachment: Attachment } | { ok: false; error: string };

/**
 * Writes one uploaded file into attachment storage and records its metadata. The bytes are written first under
 * their id, then the row; a failed row removes the bytes, so no orphan is left and no row points at nothing.
 * Only the id reaches the storage path: the uploaded name is display metadata.
 */
export async function saveAttachmentUpload(
  deps: { repos: Repos; storage: AttachmentStorage },
  upload: AttachmentUpload,
): Promise<AttachmentUploadOutcome> {
  const thread = await deps.repos.threads.get(upload.threadId);
  if (!thread) return { ok: false, error: 'The thread does not exist' };

  const name = sanitizeAttachmentName(upload.file.name);
  const mimeType = (upload.file.type.split(';')[0] ?? '').trim().toLowerCase();
  if (!isAllowedAttachmentMime(mimeType)) {
    return {
      ok: false,
      error:
        mimeType === ''
          ? `"${name}" cannot be attached: its type is unknown`
          : `"${name}" cannot be attached: ${mimeType} is not an allowed type`,
    };
  }
  if (upload.file.size === 0) return { ok: false, error: `"${name}" is empty` };
  if (upload.file.size > ATTACHMENT_MAX_BYTES) {
    return {
      ok: false,
      error: `"${name}" is ${formatAttachmentSize(upload.file.size)}; the limit is ${formatAttachmentSize(ATTACHMENT_MAX_BYTES)}`,
    };
  }

  const bytes = new Uint8Array(await upload.file.arrayBuffer());
  if (bytes.byteLength > ATTACHMENT_MAX_BYTES) {
    return {
      ok: false,
      error: `"${name}" is larger than the ${formatAttachmentSize(ATTACHMENT_MAX_BYTES)} limit`,
    };
  }
  const id = randomUUID();
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await deps.storage.write(id, bytes);
  try {
    const attachment = await deps.repos.attachments.create({
      id,
      threadId: upload.threadId,
      name,
      mimeType,
      size: bytes.byteLength,
      sha256,
    });
    return { ok: true, attachment };
  } catch (error) {
    await deps.storage.remove(id).catch(() => undefined);
    throw error;
  }
}

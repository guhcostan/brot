import { useState, type ReactElement } from 'react';
import type { Attachment } from '@brot/protocol';
import { attachmentUrl } from '../data/client';
import { formatBytes } from '../format';
import { t } from '../i18n';
import { FileDoc } from './icons';
import { AudioAttachment } from './AudioAttachment';

export interface MessageAttachmentsProps {
  attachments: readonly Attachment[];
}

/**
 * The files under a message: images as a lazy thumbnail gallery that opens the full picture, anything
 * else as a chip with its size. An image that fails to load falls back to the file chip (DESIGN.md
 * sections 4 and 7: neutral chrome, no color of its own).
 */
export function MessageAttachments({ attachments }: MessageAttachmentsProps): ReactElement | null {
  if (attachments.length === 0) return null;
  const images = attachments.filter((attachment) => attachment.kind === 'image');
  const audio = attachments.filter((attachment) => attachment.kind === 'audio');
  const files = attachments.filter((attachment) => attachment.kind === 'file');
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {images.length > 0 ? (
        <ul aria-label={t('attachment.images')} className="m-0 flex list-none flex-wrap gap-2 p-0">
          {images.map((attachment) => (
            <li key={attachment.id}>
              <ImageThumbnail attachment={attachment} />
            </li>
          ))}
        </ul>
      ) : null}
      {audio.length > 0 ? (
        <ul aria-label={t('attachment.audio')} className="m-0 flex list-none flex-col gap-2 p-0">
          {audio.map((attachment) => (
            <li key={attachment.id}>
              <AudioAttachment attachment={attachment} />
            </li>
          ))}
        </ul>
      ) : null}
      {files.length > 0 ? (
        <ul aria-label={t('attachment.files')} className="m-0 flex list-none flex-wrap gap-2 p-0">
          {files.map((attachment) => (
            <li key={attachment.id}>
              <FileChip attachment={attachment} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ImageThumbnail({ attachment }: { attachment: Attachment }): ReactElement {
  const [failed, setFailed] = useState(false);
  if (failed) return <FileChip attachment={attachment} />;
  const url = attachmentUrl(attachment.id);
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      title={t('attachment.open', { name: attachment.name })}
      className="block rounded-md transition-opacity duration-[var(--dur-fast)] hover:opacity-85"
    >
      <img
        src={url}
        alt={attachment.name}
        loading="lazy"
        onError={() => setFailed(true)}
        className="block size-16 rounded-md border border-line object-cover"
      />
    </a>
  );
}

export function FileChip({ attachment }: { attachment: Attachment }): ReactElement {
  const url = attachmentUrl(attachment.id);
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      title={t('attachment.open', { name: attachment.name })}
      className="inline-flex max-w-full items-center gap-2 rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-ink-2 transition-colors duration-[var(--dur-fast)] hover:bg-surface-2 hover:text-ink"
    >
      <span className="flex flex-none text-ink-3">
        <FileDoc size={14} />
      </span>
      <span className="min-w-0 truncate text-ink">{attachment.name}</span>
      <span className="flex-none text-ink-3 tabular-nums">{formatBytes(attachment.size)}</span>
    </a>
  );
}

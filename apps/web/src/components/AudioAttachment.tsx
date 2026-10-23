import { useState, type ReactElement } from 'react';
import type { Attachment } from '@brot/protocol';
import { attachmentUrl } from '../data/client';
import { formatBytes } from '../format';
import { t } from '../i18n';
import { FileDoc } from './icons';
import { FileChip } from './MessageAttachments';

/** A voice note or other audio attachment: native player, then a download link with name and size. */
export function AudioAttachment({ attachment, initialFailed = false }: { attachment: Attachment; initialFailed?: boolean }): ReactElement {
  const [failed, setFailed] = useState(initialFailed);
  const url = attachmentUrl(attachment.id);
  if (failed) return <FileChip attachment={attachment} />;
  return (
    <div className="flex max-w-full flex-col gap-1 rounded-md border border-line bg-surface px-2 py-1.5">
      <audio
        controls
        preload="metadata"
        src={url}
        aria-label={t('attachment.play', { name: attachment.name })}
        onError={() => setFailed(true)}
        className="h-9 max-w-[280px]"
      />
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        title={t('attachment.open', { name: attachment.name })}
        className="inline-flex min-w-0 items-center gap-1.5 text-xs text-ink-2 transition-colors duration-[var(--dur-fast)] hover:text-ink"
      >
        <FileDoc size={12} />
        <span className="min-w-0 truncate">{attachment.name}</span>
        <span className="flex-none text-ink-3 tabular-nums">{formatBytes(attachment.size)}</span>
      </a>
    </div>
  );
}

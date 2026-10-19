import type { ReactElement } from 'react';
import { cx } from './cx';

export interface MessageBubbleProps {
  role: 'user' | 'assistant' | 'system';
  content: string;
  author?: string;
  /** True while the engine is still streaming this message. */
  streaming?: boolean;
  time?: string;
  className?: string;
}

export function MessageBubble({
  role,
  content,
  author,
  streaming = false,
  time,
  className,
}: MessageBubbleProps): ReactElement {
  return (
    <div
      className={cx('brot-msg', className)}
      data-role={role}
      data-streaming={streaming ? 'true' : undefined}
      aria-busy={streaming || undefined}
    >
      {author || time ? (
        <span className="brot-msg__author">
          {author}
          {author && time ? ' · ' : null}
          {time ? <time>{time}</time> : null}
        </span>
      ) : null}
      <div className="brot-msg__bubble">{content}</div>
    </div>
  );
}

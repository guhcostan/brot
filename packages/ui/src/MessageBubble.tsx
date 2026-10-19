import { useRef, type ReactElement } from 'react';
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

/** Only the newest chunks stay wrapped, so long streams don't grow one span per token. */
const LIVE_CHUNKS = 8;

/**
 * Splits streamed content into a settled prefix and the most recent chunks, each keyed by where it
 * starts so its fade-in runs once. Boundaries only ever grow, so rendering twice is harmless.
 */
function useStreamChunks(content: string, streaming: boolean): { settled: string; chunks: Array<{ at: number; text: string }> } {
  const boundaries = useRef<number[]>([]);
  if (!streaming) {
    boundaries.current = [];
    return { settled: content, chunks: [] };
  }
  const marks = boundaries.current;
  if (marks.length === 0) marks.push(0);
  if (content.length > marks[marks.length - 1]!) marks.push(content.length);
  if (marks.length > LIVE_CHUNKS + 1) marks.splice(0, marks.length - (LIVE_CHUNKS + 1));
  const chunks = marks.slice(0, -1).map((at, index) => ({ at, text: content.slice(at, marks[index + 1]) }));
  return { settled: content.slice(0, marks[0]), chunks };
}

/** Bot messages are plain text; the user's sit in a quiet bubble on the right. */
export function MessageBubble({ role, content, author, streaming = false, time, className }: MessageBubbleProps): ReactElement {
  const { settled, chunks } = useStreamChunks(content, streaming);
  return (
    <div
      className={cx('brot-msg', className)}
      data-role={role}
      data-streaming={streaming ? 'true' : undefined}
      aria-busy={streaming || undefined}
    >
      {author || time ? (
        <span className="brot-msg__meta">
          {author ? <span className="brot-msg__author">{author}</span> : null}
          {time ? <time className="brot-msg__time">{time}</time> : null}
        </span>
      ) : null}
      <div className="brot-msg__body">
        {settled}
        {chunks.map((chunk) => (
          <span key={chunk.at} className="brot-msg__chunk">
            {chunk.text}
          </span>
        ))}
      </div>
    </div>
  );
}

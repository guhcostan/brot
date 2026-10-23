import type { ReactElement } from 'react';
import { splitMentions, type Mentionable } from '../mentions';

/** `@Name` mentions of members as quiet chips: weight and a neutral fill, no color. */
export function MentionText({ text, members }: { text: string; members: readonly Mentionable[] }): ReactElement {
  return (
    <>
      {splitMentions(text, members).map((part, index) =>
        part.kind === 'mention' ? (
          <span key={index} className="mention-chip">
            {part.text}
          </span>
        ) : (
          part.text
        ),
      )}
    </>
  );
}

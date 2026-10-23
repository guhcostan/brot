import type { ReactNode, ReactElement } from 'react';
import { splitMarkdown } from '../copy';
import { CodeBlock } from './CodeBlock';

export interface MarkdownTextProps {
  text: string;
  /** Renders the non-code runs (mentions etc.); defaults to plain text. */
  renderTextPart?: (text: string) => ReactNode;
}

/** Message text with fenced code blocks promoted to copyable code cards; everything else is plain text. */
export function MarkdownText({ text, renderTextPart }: MarkdownTextProps): ReactElement {
  return (
    <>
      {splitMarkdown(text).map((segment, index) =>
        segment.kind === 'code' ? (
          <CodeBlock key={index} language={segment.language} code={segment.code} />
        ) : renderTextPart === undefined ? (
          segment.text
        ) : (
          <span key={index}>{renderTextPart(segment.text)}</span>
        ),
      )}
    </>
  );
}

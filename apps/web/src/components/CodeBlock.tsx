import type { ReactElement } from 'react';
import { t } from '../i18n';
import { CopyButton } from './CopyButton';

export interface CodeBlockProps {
  /** The exact code between the fences, with no fences and no line numbers. */
  code: string;
  /** The fence's language; falls back to a localized "Code" label. */
  language?: string;
}

/** A fenced code block from a message: language label left, Copy right, horizontal scroll for long code. */
export function CodeBlock({ code, language }: CodeBlockProps): ReactElement {
  return (
    <div className="my-2 flex flex-col overflow-hidden rounded-md border border-line bg-surface-2">
      <div className="flex items-center justify-between gap-2 border-b border-line px-2.5 py-1">
        <span className="truncate font-mono text-xs text-ink-3">{language !== undefined && language !== '' ? language : t('copy.code')}</span>
        <CopyButton text={code} label={t('copy.copyCode')} />
      </div>
      <pre className="m-0 overflow-x-auto px-2.5 py-2">
        <code className="font-mono text-xs leading-relaxed whitespace-pre">{code}</code>
      </pre>
    </div>
  );
}

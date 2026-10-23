import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { Button, cx } from '@brot/ui';
import { writeClipboard } from '../copy';
import { t } from '../i18n';
import { Copy } from './icons';

export interface CopyButtonProps {
  /** The exact text copied; always supplied from state, never read back from the DOM. */
  text: string;
  /** What the button says before copying (localized by the caller). */
  label: string;
  /** Renders the icon only until it is activated; copied/failed states keep their text. */
  iconOnly?: boolean;
  className?: string;
}

type CopyState = 'idle' | 'copied' | 'failed';

/** A clipboard button with transient Copied and inline failure states; handlers are SSR-safe. */
export function CopyButton({ text, label, iconOnly = false, className }: CopyButtonProps): ReactElement {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);

  const copy = useCallback(async () => {
    const ok = await writeClipboard(text);
    setState(ok ? 'copied' : 'failed');
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), ok ? 1500 : 4000);
  }, [text]);

  const showsText = !iconOnly || state !== 'idle';
  return (
    <span className={cx('inline-flex items-center gap-1.5', className)}>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => void copy()}
        aria-label={state === 'copied' ? t('copy.copied') : label}
        title={state === 'copied' ? t('copy.copied') : label}
        className={cx(iconOnly && state === 'idle' && '!px-1.5 text-ink-3')}
      >
        {state !== 'copied' ? <Copy size={14} /> : null}
        {showsText && state !== 'failed' ? <span>{state === 'copied' ? t('copy.copied') : label}</span> : null}
      </Button>
      {state === 'failed' ? (
        <span role="alert" className="text-xs text-attention-text">
          {t('copy.failed')}
        </span>
      ) : null}
    </span>
  );
}

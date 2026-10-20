import { useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Button } from '@brot/ui';
import { t } from '../i18n';
import { Close } from './icons';

export interface DialogProps {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  /** Wider layouts for forms and the pop-out screen. */
  size?: 'sm' | 'md' | 'lg';
}

/**
 * A modal on the native dialog element: it traps focus, closes on Escape, and returns focus to the
 * control that opened it. On phones it sits at the bottom like a sheet.
 */
export function Dialog({ open, title, description, onClose, children, size = 'sm' }: DialogProps): ReactElement {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      data-size={size}
      className={`brot-dialog ${size === 'lg' ? 'max-w-[1080px]' : size === 'md' ? 'max-w-[600px]' : 'max-w-[440px]'}`}
    >
      {open ? (
        <div className="flex max-h-[inherit] flex-col">
          <header className="flex flex-none items-start gap-3 border-b border-line px-5 pt-4 pb-3">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <h2 id={titleId} className="m-0 text-md leading-tight font-semibold tracking-[var(--tracking-heading)]">
                {title}
              </h2>
              {description ? (
                <p id={descriptionId} className="m-0 text-sm text-ink-2">
                  {description}
                </p>
              ) : null}
            </div>
            <Button variant="ghost" size="sm" onClick={onClose} aria-label={t('dialog.close')} className="-mr-2">
              <Close size={16} />
            </Button>
          </header>
          <div className="min-h-0 overflow-y-auto">{children}</div>
        </div>
      ) : null}
    </dialog>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  /** `danger` uses the attention outline, for deletes. */
  tone?: 'primary' | 'danger';
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
}

/** Asks before an action that is hard to undo. Stays open with the error if the action fails. */
export function ConfirmDialog({ open, title, description, confirmLabel, tone = 'primary', onConfirm, onClose }: ConfirmDialogProps): ReactElement {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} title={title} description={description} onClose={onClose}>
      <div className="flex flex-col gap-4 px-5 pt-4 pb-5">
        {error ? (
          <p role="alert" className="m-0 text-sm text-attention-text">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} autoFocus>
            {t('dialog.cancel')}
          </Button>
          <Button variant={tone} disabled={busy} onClick={() => void confirm()}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

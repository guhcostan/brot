import { useId, type InputHTMLAttributes, type ReactElement, type TextareaHTMLAttributes } from 'react';
import { cx } from './cx';

interface FieldFrameProps {
  label: string;
  hint?: string;
  error?: string;
  hideLabel?: boolean;
}

function useFieldIds(id: string | undefined) {
  const generated = useId();
  const fieldId = id ?? generated;
  return { fieldId, hintId: `${fieldId}-hint`, errorId: `${fieldId}-error` };
}

function describedBy(ids: Array<string | false | undefined>): string | undefined {
  const joined = ids.filter(Boolean).join(' ');
  return joined || undefined;
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement>, FieldFrameProps {}

export function Input({ label, hint, error, hideLabel, id, className, ...rest }: InputProps): ReactElement {
  const { fieldId, hintId, errorId } = useFieldIds(id);
  return (
    <div className="brot-field">
      <label htmlFor={fieldId} className={cx('brot-field__label', hideLabel && 'brot-sr-only')}>
        {label}
      </label>
      <input
        id={fieldId}
        className={cx('brot-input', className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy([hint && hintId, error && errorId])}
        {...rest}
      />
      {hint && !error ? (
        <span id={hintId} className="brot-field__hint">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={errorId} className="brot-field__hint">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement>, FieldFrameProps {}

export function Textarea({
  label,
  hint,
  error,
  hideLabel,
  id,
  className,
  ...rest
}: TextareaProps): ReactElement {
  const { fieldId, hintId, errorId } = useFieldIds(id);
  return (
    <div className="brot-field">
      <label htmlFor={fieldId} className={cx('brot-field__label', hideLabel && 'brot-sr-only')}>
        {label}
      </label>
      <textarea
        id={fieldId}
        className={cx('brot-textarea', className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy([hint && hintId, error && errorId])}
        {...rest}
      />
      {hint && !error ? (
        <span id={hintId} className="brot-field__hint">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={errorId} className="brot-field__hint">
          {error}
        </span>
      ) : null}
    </div>
  );
}

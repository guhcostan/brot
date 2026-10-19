import type { ReactElement, ReactNode } from 'react';
import { cx } from './cx';
import { Fauna, type FaunaKind } from './fauna';

export interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** The fauna face shown above the title. Defaults to Capy, the capybara. */
  animal?: FaunaKind;
  className?: string;
}

export function EmptyState({
  title,
  description,
  actions,
  animal = 'capybara',
  className,
}: EmptyStateProps): ReactElement {
  return (
    <div className={cx('brot-empty', className)}>
      <Fauna kind={animal} size={72} />
      <h2 className="brot-empty__title">{title}</h2>
      {description ? <p className="brot-empty__body">{description}</p> : null}
      {actions ? <div className="brot-empty__actions">{actions}</div> : null}
    </div>
  );
}

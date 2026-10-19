import type { ReactElement, ReactNode } from 'react';
import { cx } from './cx';

export interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** Optional mark above the title, e.g. the bot's avatar. */
  icon?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, actions, icon, className }: EmptyStateProps): ReactElement {
  return (
    <div className={cx('brot-empty', className)}>
      {icon ? <div className="brot-empty__icon">{icon}</div> : null}
      <h2 className="brot-empty__title">{title}</h2>
      {description ? <p className="brot-empty__body">{description}</p> : null}
      {actions ? <div className="brot-empty__actions">{actions}</div> : null}
    </div>
  );
}

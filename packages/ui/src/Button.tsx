import type { ButtonHTMLAttributes, ReactElement } from 'react';
import { cx } from './cx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** `icon` is a 36px circle for a single glyph; give it an aria-label. */
  size?: 'md' | 'sm' | 'icon';
}

export function Button({
  variant = 'primary',
  size = 'md',
  type = 'button',
  className,
  ...rest
}: ButtonProps): ReactElement {
  return <button type={type} className={cx('brot-button', className)} data-variant={variant} data-size={size} {...rest} />;
}

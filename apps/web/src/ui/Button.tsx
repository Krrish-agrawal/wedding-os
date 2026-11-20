import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from './cn';
import { BASE, ICON_ONLY, ICON_SIZE, SIZES, VARIANTS, type ButtonSize, type ButtonVariant } from './buttonClasses';
import { Spinner } from './Spinner';
import { ICON_STROKE } from './icons';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  /** Icon after the label, e.g. an arrow on a forward action. */
  trailingIcon?: LucideIcon;
  /** Shows a spinner in place of the icon and disables the button. */
  busy?: boolean;
  /** Renders a square icon-only button; `label` becomes its accessible name. */
  iconOnly?: boolean;
  label?: string;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', icon: Icon, trailingIcon: Trailing, busy = false, iconOnly = false, label, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  const iconSize = ICON_SIZE[size];
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      aria-label={iconOnly ? label : rest['aria-label']}
      title={iconOnly ? label : rest.title}
      className={cn(BASE, VARIANTS[variant], iconOnly ? ICON_ONLY[size] : SIZES[size], className)}
      {...rest}
    >
      {busy ? <Spinner size={iconSize} /> : Icon ? <Icon size={iconSize} strokeWidth={ICON_STROKE} aria-hidden /> : null}
      {!iconOnly && children}
      {!iconOnly && Trailing && !busy ? <Trailing size={iconSize} strokeWidth={ICON_STROKE} aria-hidden /> : null}
    </button>
  );
});

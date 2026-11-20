import { forwardRef, useId, type InputHTMLAttributes } from 'react';
import { CircleAlert } from 'lucide-react';
import { cn } from './cn';
import { ICON_STROKE } from './icons';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label: string;
  /** Helper text under the field, replaced by the error when there is one. */
  hint?: string;
  error?: string | null;
}

/** Labelled text input with an inline validation message. */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField({ label, hint, error, className, id, ...rest }, ref) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const noteId = `${inputId}-note`;
  const hasNote = Boolean(error || hint);
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={inputId} className="text-sm font-bold text-ink">
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={hasNote ? noteId : undefined}
        className={cn(
          'h-12 w-full rounded-[var(--radius-control)] border-2 bg-canvas px-4 text-[15px] text-ink outline-none',
          'placeholder:text-ink-mute transition-[border-color,box-shadow] duration-100',
          'focus:border-ink focus:shadow-[var(--shadow-pop-blue)]',
          error ? 'border-coral-deep' : 'border-ink/25 hover:border-ink/50',
        )}
        {...rest}
      />
      {error ? (
        <p id={noteId} className="flex items-center gap-1.5 text-[13px] font-semibold text-coral-deep">
          <CircleAlert size={14} strokeWidth={ICON_STROKE} aria-hidden />
          {error}
        </p>
      ) : hint ? (
        <p id={noteId} className="text-[13px] text-ink-soft">
          {hint}
        </p>
      ) : null}
    </div>
  );
});

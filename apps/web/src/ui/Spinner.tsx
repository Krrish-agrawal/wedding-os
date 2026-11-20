import { LoaderCircle } from 'lucide-react';
import { cn } from './cn';
import { ICON_STROKE } from './icons';

/** Inline busy indicator. Only shown while something is actually in flight. */
export function Spinner({ size = 16, className, label }: { size?: number; className?: string; label?: string }) {
  return (
    <LoaderCircle
      size={size}
      strokeWidth={ICON_STROKE}
      className={cn('shrink-0 animate-spin motion-reduce:animate-none', className)}
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}

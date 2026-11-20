import type { ReactNode } from 'react';
import { cn } from './cn';

/** A keyboard key, e.g. <Kbd>Enter</Kbd>. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-6 min-w-6 items-center justify-center rounded-md border-2 border-current px-1.5 font-sans text-[11px] font-bold leading-none opacity-80',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { cn } from './cn';
import { Mascot } from './mascot/Mascot';
import { BrandMark } from './mascot/BrandMark';
import type { MascotState } from './mascot/states';

interface StateBlockProps {
  title: ReactNode;
  body?: ReactNode;
  /** Buttons or links for the way forward. Every empty or error state offers one. */
  actions?: ReactNode;
  mascot?: MascotState;
  /** Mascot size in px. */
  mascotSize?: number;
  /** `page` centres in the full viewport; `panel` fills its container. */
  layout?: 'page' | 'panel';
  className?: string;
}

function StateBlock({ title, body, actions, mascot = 'idle', mascotSize = 120, layout = 'panel', className, role }: StateBlockProps & { role?: 'alert' | 'status' }) {
  return (
    <div className={cn('relative grid place-items-center p-8 text-center', layout === 'page' ? 'min-h-full' : 'h-full', className)}>
      {layout === 'page' && (
        <header className="absolute left-10 top-7">
          <BrandMark size="sm" />
        </header>
      )}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: [0.2, 0.9, 0.25, 1] }}
        className="flex max-w-md flex-col items-center"
        role={role}
      >
        <Mascot state={mascot} size={mascotSize} />
        <h2 className={cn('mt-5 font-display font-bold leading-tight', layout === 'page' ? 'text-3xl' : 'text-2xl')}>{title}</h2>
        {body ? <div className="mt-2 text-[15px] text-ink-soft">{body}</div> : null}
        {actions ? <div className="mt-6 flex flex-wrap items-center justify-center gap-3">{actions}</div> : null}
      </motion.div>
    </div>
  );
}

/** Nothing to show yet, with a way forward. */
export function EmptyState(props: StateBlockProps) {
  return <StateBlock mascot="idle" {...props} />;
}

/** Something went wrong: say what, calmly, and offer the next step. */
export function ErrorState(props: StateBlockProps) {
  return <StateBlock mascot="apologetic" role="alert" {...props} />;
}

/** Waiting on something real (a socket, a request). Not for local data. */
export function LoadingState(props: Omit<StateBlockProps, 'actions'>) {
  return <StateBlock mascot="thinking" role="status" {...props} />;
}

/**
 * Placeholder block for data that is genuinely remote and slow (a summary being generated).
 * Static, no shimmer: local data never needs one.
 */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cn('block rounded-[10px] bg-paper', className)} />;
}

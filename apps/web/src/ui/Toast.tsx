import { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CircleAlert, CircleCheck, Info, X, type LucideIcon } from 'lucide-react';
import { cn } from './cn';
import { ICON_STROKE } from './icons';
import { TOAST_LIFETIME_MS, useToasts, type ToastItem, type ToastTone } from './toastStore';

const TONE: Record<ToastTone, { icon: LucideIcon; mark: string }> = {
  info: { icon: Info, mark: 'bg-blue' },
  success: { icon: CircleCheck, mark: 'bg-mint' },
  error: { icon: CircleAlert, mark: 'bg-coral' },
};

function ToastCard({ item }: { item: ToastItem }) {
  const dismiss = useToasts((s) => s.dismiss);
  useEffect(() => {
    const t = setTimeout(() => dismiss(item.id), TOAST_LIFETIME_MS);
    return () => clearTimeout(t);
  }, [item.id, dismiss]);
  const { icon: Icon, mark } = TONE[item.tone];
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: -16, transition: { duration: 0.12 } }}
      transition={{ type: 'spring', stiffness: 520, damping: 34 }}
      role={item.tone === 'error' ? 'alert' : 'status'}
      className="pointer-events-auto flex w-[360px] items-start gap-3 rounded-[16px] border-2 border-ink bg-canvas p-3 pr-2 shadow-[var(--shadow-pop)]"
    >
      <span aria-hidden className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-[9px] border-2 border-ink text-ink', mark)}>
        <Icon size={15} strokeWidth={ICON_STROKE} />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-sm font-bold leading-snug">{item.title}</p>
        {item.body ? <p className="mt-0.5 text-sm text-ink-soft">{item.body}</p> : null}
      </div>
      <button
        type="button"
        onClick={() => dismiss(item.id)}
        aria-label="Dismiss"
        className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] text-ink-soft hover:bg-paper hover:text-ink"
      >
        <X size={15} strokeWidth={ICON_STROKE} aria-hidden />
      </button>
    </motion.li>
  );
}

/** Mount once per screen. Toasts stack bottom-left, away from the call controls. */
export function Toaster() {
  const items = useToasts((s) => s.items);
  return (
    <ol aria-label="Notifications" className="pointer-events-none fixed bottom-5 left-5 z-50 flex flex-col gap-2">
      <AnimatePresence initial={false}>
        {items.map((t) => (
          <ToastCard key={t.id} item={t} />
        ))}
      </AnimatePresence>
    </ol>
  );
}

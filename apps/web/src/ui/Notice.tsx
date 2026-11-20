import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from './cn';
import { ICON_STROKE } from './icons';
import { Mascot } from './mascot/Mascot';
import type { MascotState } from './mascot/states';

export type NoticeTone = 'info' | 'waiting' | 'success' | 'warn' | 'error';

const TONE: Record<NoticeTone, { surface: string; mark: string }> = {
  info: { surface: 'bg-blue-tint', mark: 'bg-blue' },
  waiting: { surface: 'bg-sun-tint', mark: 'bg-sun' },
  success: { surface: 'bg-mint-tint', mark: 'bg-mint' },
  warn: { surface: 'bg-tangerine-tint', mark: 'bg-tangerine' },
  error: { surface: 'bg-coral-tint', mark: 'bg-coral' },
};

export interface NoticeProps {
  tone?: NoticeTone;
  title: ReactNode;
  body?: ReactNode;
  icon?: LucideIcon;
  /** Shows the mascot in place of the icon, for moments that deserve a face. */
  mascot?: MascotState;
  actions?: ReactNode;
  /** Announce politely (status) or interrupt (alert). */
  live?: 'polite' | 'assertive' | 'off';
  className?: string;
}

/** A calm, inline message: connection trouble, voice unavailable, a handoff in progress. */
export function Notice({ tone = 'info', title, body, icon: Icon, mascot, actions, live = 'polite', className }: NoticeProps) {
  const t = TONE[tone];
  return (
    <div
      role={live === 'assertive' ? 'alert' : live === 'polite' ? 'status' : undefined}
      className={cn('flex items-start gap-3 rounded-[16px] border-2 border-ink p-3', t.surface, className)}
    >
      {mascot ? (
        <Mascot state={mascot} size={44} shadow={false} className="-my-1" />
      ) : Icon ? (
        <span aria-hidden className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-[10px] border-2 border-ink text-ink', t.mark)}>
          <Icon size={16} strokeWidth={ICON_STROKE} />
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold leading-snug text-ink">{title}</p>
        {body ? <div className="mt-0.5 text-[13px] leading-snug text-ink-soft">{body}</div> : null}
        {actions ? <div className="mt-2 flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

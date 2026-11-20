import type { ReactNode } from 'react';
import { KeyRound } from 'lucide-react';
import { PAYABLE_AT_LABELS, formatINR, formatINRShort, type PaymentPlan } from '@ave/shared';
import { Card, ICON_STROKE, cn } from '@/ui';

/** The payment schedule as a stepped list, ending with what is paid at registration and handover. */
export function ScheduleTab({ plan }: { plan: PaymentPlan }) {
  const handoverStep = plan.stages.length + 1;
  return (
    <Card elevation="flat" className="p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-lg font-extrabold leading-tight">When you pay</h3>
        <p className="text-sm text-ink-soft">
          Instalments on <span className="font-semibold text-ink tabular">{formatINR(plan.instalmentBasis)}</span>, GST included
        </p>
      </div>

      <ol className="mt-4">
        {plan.stages.map((s, i) => (
          <Step key={s.id} index={i + 1} last={false}>
            <div className="min-w-0 flex-1">
              <p className="font-bold leading-snug">{s.stage}</p>
              {s.due ? <p className="text-sm text-ink-soft">{s.due}</p> : null}
            </div>
            <span className="mt-0.5 shrink-0 rounded-[8px] bg-coral-tint px-2 py-0.5 text-xs font-bold tabular">{s.percent}%</span>
            <span className="w-32 shrink-0 text-right font-semibold tabular">{formatINR(s.amount)}</span>
          </Step>
        ))}
        <Step index={handoverStep} last icon>
          <div className="min-w-0 flex-1">
            <p className="font-bold leading-snug">{PAYABLE_AT_LABELS.handover}</p>
            <ul className="mt-1 flex max-w-md flex-col gap-0.5 text-sm text-ink-soft">
              {plan.handover.items.map((i) => (
                <li key={i.id} className="flex justify-between gap-2">
                  <span className="truncate">{i.label}</span>
                  <span className="shrink-0 tabular">{i.discount > 0 && i.amount === 0 ? 'Waived' : formatINRShort(i.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
          <span className="w-32 shrink-0 text-right font-semibold tabular">{formatINR(plan.handover.amount)}</span>
        </Step>
      </ol>

      <div className="mt-4 flex items-baseline justify-between border-t-2 border-ink pt-3">
        <span className="font-bold">Adds up to your price</span>
        <span className="font-display text-xl font-extrabold tabular">{formatINR(plan.total)}</span>
      </div>
    </Card>
  );
}

function Step({ index, last, icon = false, children }: { index: number; last: boolean; icon?: boolean; children: ReactNode }) {
  return (
    <li className="relative flex gap-4 pb-4 last:pb-0">
      {!last && <span aria-hidden className="absolute bottom-0 left-[15px] top-8 w-0.5 bg-ink" />}
      <span
        aria-hidden
        className={cn(
          'relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 border-ink text-sm font-bold tabular',
          icon ? 'bg-coral' : 'bg-canvas',
        )}
      >
        {icon ? <KeyRound size={15} strokeWidth={ICON_STROKE} /> : index}
      </span>
      <div className="flex min-w-0 flex-1 items-start gap-3 pt-1">{children}</div>
    </li>
  );
}

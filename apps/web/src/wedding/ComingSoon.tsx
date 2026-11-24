import type { LucideIcon } from 'lucide-react';
import { Card, ICON_STROKE, Pill } from '@/ui';

/** An honest placeholder for a section that a later milestone delivers. */
export default function ComingSoon({ icon: Icon, title, milestone, children }: { icon: LucideIcon; title: string; milestone: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <h1 className="font-display text-4xl font-extrabold">{title}</h1>
      <Card className="flex flex-col items-start gap-3 p-6">
        <span aria-hidden className="grid h-12 w-12 place-items-center rounded-[14px] border-2 border-ink bg-sun-tint"><Icon size={24} strokeWidth={ICON_STROKE} /></span>
        <Pill tone="waiting" size="sm">Not built yet · {milestone}</Pill>
        <div className="text-ink-soft">{children}</div>
      </Card>
    </div>
  );
}

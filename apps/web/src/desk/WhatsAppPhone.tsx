import { CheckCheck, Eye } from 'lucide-react';
import { formatTimeIST, type OutboxItem } from '@ave/shared';
import { ICON_STROKE, Mascot, cn } from '@/ui';
import { WhatsAppText } from './LeadDetail';

/**
 * The buyer's WhatsApp conversation as it reads on their phone: every message the app composed for
 * this lead, oldest first. Messages that were not delivered (preview mode, not configured, failed)
 * carry a plain "Preview" mark instead of delivery ticks, and a banner says nothing was sent.
 */
export function WhatsAppPhone({ items, draft, buyerName }: { items: OutboxItem[]; draft: string | null; buyerName: string }) {
  const messages = items.filter((i) => i.channel === 'whatsapp' && i.text).sort((a, b) => a.at - b.at);
  const anySent = messages.some((m) => m.status === 'sent');
  const allPreview = messages.length > 0 && !anySent;
  const shown: { key: string; text: string; at: number | null; sent: boolean }[] = messages.length
    ? messages.map((m) => ({ key: m.id, text: m.text ?? '', at: m.at, sent: m.status === 'sent' }))
    : draft
      ? [{ key: 'draft', text: draft, at: null, sent: false }]
      : [];

  return (
    <div className="mx-auto w-full max-w-[380px]">
      <div className="overflow-hidden rounded-[36px] border-[3px] border-ink bg-ink p-2 shadow-[var(--shadow-pop-lg)]">
        <div className="overflow-hidden rounded-[28px] bg-canvas">
          <header className="flex items-center gap-3 bg-[#075e54] px-4 py-3 text-canvas">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-canvas">
              <Mascot size={30} shadow={false} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[15px] font-bold leading-tight">Agora Virtual Estates</p>
              <p className="truncate text-xs opacity-80">Chat with {buyerName}</p>
            </div>
          </header>

          {(allPreview || !messages.length) && (
            <p className="flex items-center gap-1.5 bg-sun-tint px-4 py-2 text-xs font-semibold text-ink">
              <Eye size={14} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0" />
              Preview of what the buyer receives. Not sent from this demo.
            </p>
          )}

          <ol className="scroll-quiet flex max-h-[560px] min-h-[320px] flex-col gap-2.5 overflow-y-auto bg-[#ece5dd] px-3 py-4" aria-label={`WhatsApp messages to ${buyerName}`}>
            {shown.length === 0 ? (
              <li className="m-auto text-center text-sm text-ink-soft">No WhatsApp messages for this lead yet.</li>
            ) : (
              shown.map((m) => (
                <li key={m.key} className="max-w-[88%] self-end">
                  <div className="whitespace-pre-wrap rounded-[12px] rounded-tr-[4px] bg-[#dcf8c6] px-3 py-2 text-[13.5px] leading-snug text-ink shadow-[0_1px_0_rgba(0,0,0,0.12)]">
                    <WhatsAppText text={m.text} />
                    <span className="mt-1 flex items-center justify-end gap-1 text-[11px] text-ink-soft">
                      {m.at !== null ? formatTimeIST(m.at) : 'Draft'}
                      {m.sent ? (
                        <CheckCheck size={14} strokeWidth={ICON_STROKE} aria-label="Delivered to WhatsApp" className="text-blue-deep" />
                      ) : (
                        <span className={cn('rounded-[6px] bg-canvas/70 px-1 font-semibold')}>Preview</span>
                      )}
                    </span>
                  </div>
                </li>
              ))
            )}
          </ol>
        </div>
      </div>
    </div>
  );
}

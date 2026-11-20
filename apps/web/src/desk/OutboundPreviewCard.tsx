import { useEffect, useId, useState } from 'react';
import { ExternalLink, ImageOff, RotateCcw, Send, X } from 'lucide-react';
import type { OutboundChannel } from '@ave/shared';
import { ACCENT_TINT, Button, ICON_STROKE, Pill, cn } from '@/ui';
import type { Accent } from '@/views/types';
import { CHANNEL_ICON, CHANNEL_NAME, DELIVERY_STATUS } from './display';
import type { PreviewEdits } from './copilotApi';
import type { PreviewCardState } from './useCopilot';

const CHANNEL_ACCENT: Record<OutboundChannel, Accent> = {
  whatsapp: 'mint',
  email: 'blue',
  slack: 'grape',
  jira: 'sun',
};

const SUBJECT_LABEL: Partial<Record<OutboundChannel, string>> = { email: 'Subject', jira: 'Summary' };
const TEXT_ROWS = 3;
const MEDIA_PREFIX = '/media/';

/** The same image from this app's own server, so the thumbnail shows even when the tunnel is down. */
function thumbnailSrc(mediaUrl: string): string {
  try {
    const { pathname } = new URL(mediaUrl);
    return pathname.startsWith(MEDIA_PREFIX) ? pathname : mediaUrl;
  } catch {
    return mediaUrl;
  }
}

function dueLabel(days: number): string {
  return days === 0 ? 'Due today' : days === 1 ? 'Due tomorrow' : `Due in ${days} days`;
}

/**
 * One message waiting for the admin: who it goes to, editable subject and text, the photo if there is
 * one, and Send or Discard. After a send it says exactly what happened: Sent, Failed (why) or Not
 * configured.
 */
export function OutboundPreviewCard({ card, onSend, onDismiss }: { card: PreviewCardState; onSend: (edits: PreviewEdits) => void; onDismiss: () => void }) {
  const { preview, phase, delivery, error } = card;
  const [text, setText] = useState(preview.text);
  const [subject, setSubject] = useState(preview.subject ?? '');
  const [imageFailed, setImageFailed] = useState(false);
  const textId = useId();
  const subjectId = useId();
  const recap = preview.purpose === 'recap';
  const editable = phase === 'draft' && !recap;
  const Icon = CHANNEL_ICON[preview.channel];
  const accent = CHANNEL_ACCENT[preview.channel];
  const subjectLabel = SUBJECT_LABEL[preview.channel];

  useEffect(() => setImageFailed(false), [preview.mediaUrl]);

  const submit = () => {
    if (!text.trim()) return;
    onSend(recap ? {} : { text: text.trim(), ...(subjectLabel ? { subject: subject.trim() || null } : {}) });
  };

  const status = delivery ? DELIVERY_STATUS[delivery.status] : null;
  const failed = delivery?.status === 'failed';
  // Retrying cannot help until the integration is set up, so only closing is offered.
  const notConfigured = delivery?.status === 'not_configured';

  return (
    <article
      aria-label={`${CHANNEL_NAME[preview.channel]} to ${preview.to}`}
      className={cn('flex w-[340px] shrink-0 flex-col gap-2 rounded-[16px] border-2 border-ink bg-canvas p-3 shadow-[var(--shadow-pop-sm)]', phase === 'done' && 'bg-mint-tint')}
    >
      <header className="flex items-start gap-2">
        <span aria-hidden className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-[10px] border-2 border-ink', ACCENT_TINT[accent])}>
          <Icon size={16} strokeWidth={ICON_STROKE} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">
            {CHANNEL_NAME[preview.channel]}
            {recap ? ' · Recap' : preview.nextStepId ? ' · Next step' : ''}
          </p>
          <p className="truncate text-sm font-bold" title={preview.to}>
            To {preview.to}
          </p>
        </div>
        {phase !== 'sending' ? (
          <button
            type="button"
            onClick={onDismiss}
            aria-label={phase === 'done' ? 'Close' : 'Discard this message'}
            title={phase === 'done' ? 'Close' : 'Discard'}
            className="grid h-7 w-7 place-items-center rounded-[8px] text-ink-soft hover:bg-paper hover:text-ink"
          >
            <X size={15} strokeWidth={ICON_STROKE} aria-hidden />
          </button>
        ) : null}
      </header>

      {subjectLabel ? (
        <div className="flex flex-col gap-1">
          <label htmlFor={subjectId} className="text-[11px] font-bold text-ink-soft">
            {subjectLabel}
          </label>
          <input
            id={subjectId}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            readOnly={!editable}
            maxLength={200}
            className="h-9 rounded-[10px] border-2 border-ink/20 bg-canvas px-2.5 text-[13px] font-semibold outline-none read-only:bg-paper focus:border-ink"
          />
        </div>
      ) : null}

      {preview.mediaUrl ? (
        imageFailed ? (
          <p className="flex items-center gap-1.5 rounded-[10px] bg-paper px-2.5 py-2 text-xs text-ink-soft">
            <ImageOff size={14} strokeWidth={ICON_STROKE} aria-hidden /> Photo attached (preview unavailable)
          </p>
        ) : (
          <img src={thumbnailSrc(preview.mediaUrl)} alt="Photo sent with the message" onError={() => setImageFailed(true)} className="h-20 w-full rounded-[10px] border-2 border-line bg-paper object-cover" />
        )
      ) : null}

      <div className="flex flex-col gap-1">
        <label htmlFor={textId} className="sr-only">
          Message
        </label>
        <textarea
          id={textId}
          value={text}
          onChange={(e) => setText(e.target.value)}
          readOnly={!editable}
          rows={TEXT_ROWS}
          maxLength={4000}
          className="scroll-quiet resize-none rounded-[10px] border-2 border-ink/20 bg-canvas px-2.5 py-2 text-[13px] leading-snug outline-none read-only:bg-paper focus:border-ink"
        />
        {recap ? <p className="text-[11px] text-ink-soft">Goes out exactly as the recap renders{preview.channel === 'email' ? ', with the visit invite when one is booked' : ''}.</p> : null}
        {preview.dueInDays !== null ? <p className="text-[11px] font-semibold text-ink-soft">{dueLabel(preview.dueInDays)}</p> : null}
      </div>

      {status && delivery ? (
        <div className={cn('rounded-[10px] px-2.5 py-1.5 text-xs', delivery.status === 'sent' ? 'bg-canvas' : 'bg-coral-tint')}>
          <span className="flex items-center gap-2">
            <Pill tone={status.tone} size="sm" className="h-6">
              {status.label}
            </Pill>
            {delivery.url ? (
              <a href={delivery.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-blue-deep underline decoration-2 underline-offset-2">
                {delivery.ref ?? 'Open'} <ExternalLink size={12} strokeWidth={ICON_STROKE} aria-hidden />
              </a>
            ) : delivery.ref && delivery.channel === 'jira' ? (
              <span className="font-semibold">{delivery.ref}</span>
            ) : null}
          </span>
          {delivery.status !== 'sent' && delivery.detail ? <p className="mt-1">{delivery.detail}</p> : null}
        </div>
      ) : null}
      {error ? <p className="rounded-[10px] bg-coral-tint px-2.5 py-1.5 text-xs">{error}</p> : null}

      {phase !== 'done' ? (
        <footer className="flex items-center justify-end gap-2">
          <Button variant={notConfigured ? 'secondary' : 'ghost'} size="sm" onClick={onDismiss} disabled={phase === 'sending'}>
            {notConfigured ? 'Close' : 'Discard'}
          </Button>
          {notConfigured ? null : (
            <Button variant="primary" size="sm" icon={failed ? RotateCcw : Send} busy={phase === 'sending'} disabled={!text.trim()} onClick={submit}>
              {failed ? 'Try again' : 'Send'}
            </Button>
          )}
        </footer>
      ) : null}
    </article>
  );
}

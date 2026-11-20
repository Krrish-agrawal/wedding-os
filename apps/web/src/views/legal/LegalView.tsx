import { CircleCheck, CircleSlash, FileCheck, Hourglass, MousePointerClick, X, type LucideIcon } from 'lucide-react';
import type { LegalDoc } from '@ave/shared';
import { Button, Card, EmptyState, ICON_STROKE, Pill, cn, type PillTone } from '@/ui';
import type { ViewProps } from '../types';
import { ViewHeader } from '../money/parts';

type DocStatus = LegalDoc['status'];

const STATUS_ORDER: readonly DocStatus[] = ['verified', 'pending', 'not_applicable'];

const STATUS: Record<DocStatus, { label: string; tone: PillTone; icon: LucideIcon; meaning: string; fill: string }> = {
  verified: {
    label: 'Verified',
    tone: 'live',
    icon: CircleCheck,
    meaning: 'Checked against the original document.',
    fill: 'bg-mint',
  },
  pending: {
    label: 'Pending',
    tone: 'waiting',
    icon: Hourglass,
    meaning: 'Not issued or not complete yet. Read what that means for you before you commit.',
    fill: 'bg-sun',
  },
  not_applicable: {
    label: 'Not applicable',
    tone: 'muted',
    icon: CircleSlash,
    meaning: 'Does not apply to this property.',
    fill: 'bg-paper',
  },
};

const docDate = new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });

function formatDocDate(iso: string): string {
  const t = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(t) ? iso : docDate.format(new Date(t));
}

function StatusPill({ status, size = 'sm' }: { status: DocStatus; size?: 'sm' | 'md' }) {
  const s = STATUS[status];
  return (
    <Pill tone={s.tone} icon={s.icon} size={size}>
      {s.label}
    </Pill>
  );
}

/** Legal view (BUILD_PLAN.md section 4.2.8). Accent: mint. Sample documents with plain-language explanations. */
export default function LegalView({ state, bundle, dispatch }: ViewProps) {
  if (!bundle) {
    return <EmptyState title="Pick a property to check its paperwork" body="Open a property from the shortlist and its documents appear here." />;
  }
  const { property, legal } = bundle;
  const docs = legal.documents;
  const selected = docs.find((d) => d.id === state.params.legal.docId) ?? null;
  const select = (docId: string | null) => dispatch({ type: 'set_view', view: 'legal', params: { docId } });
  const counts = STATUS_ORDER.map((status) => ({ status, count: docs.filter((d) => d.status === status).length })).filter((c) => c.count > 0);

  return (
    <div className="@container flex h-full flex-col gap-5 overflow-y-auto p-6 scroll-quiet">
      <ViewHeader
        accent="mint"
        icon={FileCheck}
        eyebrow={`${property.name} · ${property.configuration}`}
        title="Legal papers"
        aside={
          <>
            {counts.map(({ status, count }) => (
              <Pill key={status} tone={STATUS[status].tone} icon={STATUS[status].icon} size="sm">
                <span className="tabular">{count}</span> {STATUS[status].label.toLowerCase()}
              </Pill>
            ))}
          </>
        }
      />

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(300px,400px)] items-start gap-5">
        <ul className="grid grid-cols-1 gap-3 @4xl:grid-cols-2" aria-label="Documents">
          {docs.map((doc) => {
            const isSelected = doc.id === selected?.id;
            return (
              <li key={doc.id}>
                <button
                  type="button"
                  onClick={() => select(doc.id)}
                  aria-pressed={isSelected}
                  className={cn(
                    'flex h-full w-full flex-col gap-1.5 rounded-[16px] border-2 p-4 text-left',
                    'transition-[transform,box-shadow,border-color,background-color] duration-100 ease-[var(--ease-snap)]',
                    isSelected
                      ? '-translate-x-px -translate-y-px border-ink bg-mint-tint shadow-[var(--shadow-pop)]'
                      : 'border-line bg-canvas hover:border-ink active:translate-y-px',
                  )}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="font-bold leading-snug">{doc.title}</span>
                    <StatusPill status={doc.status} />
                  </span>
                  <span className="line-clamp-2 text-sm leading-snug text-ink-soft">{doc.summary}</span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="sticky top-0">
          {selected ? <DocPanel doc={selected} onClose={() => select(null)} /> : <Overview docs={docs} />}
        </div>
      </div>
    </div>
  );
}

function DocPanel({ doc, onClose }: { doc: LegalDoc; onClose: () => void }) {
  const status = STATUS[doc.status];
  return (
    <Card as="article" className="flex flex-col p-6" aria-labelledby={`doc-${doc.id}`}>
      <div className="flex items-center justify-between gap-3">
        <StatusPill status={doc.status} size="md" />
        <Button variant="ghost" size="sm" iconOnly icon={X} label="Back to all documents" onClick={onClose} />
      </div>
      <h3 id={`doc-${doc.id}`} className="mt-3 text-2xl font-extrabold leading-tight">
        {doc.title}
      </h3>
      <p className="mt-2 font-semibold leading-snug">{doc.summary}</p>
      <p className="mt-3 text-[15px] leading-relaxed text-ink">{doc.explanation}</p>
      {doc.status !== 'verified' ? (
        <p className={cn('mt-4 flex items-start gap-2 rounded-[12px] border-2 border-ink px-3 py-2 text-sm', doc.status === 'pending' ? 'bg-sun-tint' : 'bg-paper')}>
          <status.icon size={16} strokeWidth={ICON_STROKE} aria-hidden className="mt-0.5 shrink-0" />
          <span>
            <span className="font-bold">{status.label}:</span> {status.meaning}
          </span>
        </p>
      ) : null}
      <dl className="mt-5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 border-t-2 border-line pt-4 text-sm">
        <dt className="text-ink-soft">Reference</dt>
        <dd className="break-words font-semibold tabular">{doc.reference}</dd>
        <dt className="text-ink-soft">Issued by</dt>
        <dd className="font-semibold">{doc.issuedBy}</dd>
        {doc.date ? (
          <>
            <dt className="text-ink-soft">Dated</dt>
            <dd className="font-semibold tabular">{formatDocDate(doc.date)}</dd>
          </>
        ) : null}
      </dl>
      <p className="mt-3 text-xs text-ink-soft">Sample document for a demo listing. References are not real registrations.</p>
    </Card>
  );
}

function Overview({ docs }: { docs: LegalDoc[] }) {
  const applicable = docs.filter((d) => d.status !== 'not_applicable');
  const verified = docs.filter((d) => d.status === 'verified').length;
  const pending = docs.filter((d) => d.status === 'pending');
  return (
    <Card as="aside" className="flex flex-col p-6" aria-label="Where the paperwork stands">
      <p className="text-sm font-semibold text-ink-soft">Where the paperwork stands</p>
      <p className="mt-1 font-display text-[40px] font-extrabold leading-none tracking-[-0.02em] tabular">
        {verified} of {applicable.length}
      </p>
      <p className="mt-1 text-sm text-ink-soft">documents that apply here are verified</p>

      <div className="mt-4 flex h-4 overflow-hidden rounded-full border-2 border-ink" role="img" aria-label={`${verified} verified, ${pending.length} pending`}>
        {[...docs]
          .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status))
          .map((d, i) => (
            <span key={d.id} className={cn('h-full flex-1', STATUS[d.status].fill, i > 0 && 'border-l-2 border-ink')} />
          ))}
      </div>

      {pending.length > 0 ? (
        <div className="mt-4 rounded-[12px] border-2 border-ink bg-sun-tint px-3 py-2 text-sm">
          <p className="font-bold">Still pending</p>
          <ul className="mt-0.5 text-ink-soft">
            {pending.map((d) => (
              <li key={d.id}>{d.title}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <dl className="mt-4 flex flex-col gap-2 text-sm">
        {STATUS_ORDER.map((s) => (
          <div key={s} className="flex items-start gap-2">
            <dt className="shrink-0">
              <StatusPill status={s} />
            </dt>
            <dd className="pt-1 text-ink-soft">{STATUS[s].meaning}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-5 flex items-center gap-2 text-sm font-semibold">
        <MousePointerClick size={16} strokeWidth={ICON_STROKE} aria-hidden className="text-mint-deep" />
        Pick a card to read what it means in plain words.
      </p>
    </Card>
  );
}

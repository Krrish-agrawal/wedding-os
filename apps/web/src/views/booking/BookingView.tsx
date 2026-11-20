import { CalendarCheck, CalendarDays, CalendarX, Check, CircleCheckBig, Clock, MapPin, Repeat } from 'lucide-react';
import {
  describeSlot,
  formatSlotDay,
  formatSlotDayShort,
  formatSlotRange,
  formatSlotTime,
  groupSlotsByDay,
  isWeekendSlot,
  slotLocalParts,
  type Property,
  type VisitSlot,
} from '@ave/shared';
import { getBundle } from '@/content';
import { Button, Card, EmptyState, ICON_STROKE, Notice, Tag, cn } from '@/ui';
import type { ViewProps } from '../types';
import { ViewHeader } from '../money/parts';

const MS_PER_MINUTE = 60_000;

function durationMinutes(slot: VisitSlot): number {
  return Math.round((Date.parse(slot.end) - Date.parse(slot.start)) / MS_PER_MINUTE);
}

const weekdayShort = new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', weekday: 'short' });
const monthShort = new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', month: 'short' });

/** Big date block for a day row: "SUN / 22 / Nov", in the property's local date. */
function dayParts(iso: string): { weekday: string; day: string; month: string } {
  const date = slotLocalParts(iso)?.date ?? iso.slice(0, 10);
  const d = new Date(`${date}T00:00:00Z`);
  return { weekday: weekdayShort.format(d), day: String(d.getUTCDate()), month: monthShort.format(d) };
}

/**
 * Booking view (BUILD_PLAN.md section 4.2.9). Accent: mint.
 * Picking a slot is a selection everyone on the call sees; "Confirm visit" is the buyer's explicit yes.
 */
export default function BookingView({ state, bundle, dispatch }: ViewProps) {
  if (!bundle) {
    return <EmptyState title="Pick a property to book a visit" body="Open a property from the shortlist and its visit times appear here." />;
  }
  const { property, visits } = bundle;
  const propertyId = property.id;
  const days = groupSlotsByDay(visits);
  const open = visits.filter((s) => s.available);

  const booking = state.booking;
  const bookedHere = booking.status === 'confirmed' && booking.propertyId === propertyId ? visits.find((s) => s.id === booking.slotId) ?? null : null;
  const otherBundle = booking.status === 'confirmed' && booking.propertyId !== propertyId ? getBundle(booking.propertyId) : null;
  const otherSlot = otherBundle?.visits.find((s) => s.id === booking.slotId) ?? null;

  const selected = visits.find((s) => s.id === state.params.booking.slotId) ?? null;
  const select = (slotId: string) => dispatch({ type: 'set_view', view: 'booking', params: { slotId } });
  const confirm = (slotId: string) => dispatch({ type: 'confirm_booking', propertyId, slotId });

  return (
    <div className="@container flex h-full flex-col gap-5 overflow-y-auto p-6 scroll-quiet">
      <ViewHeader
        accent="mint"
        icon={CalendarCheck}
        eyebrow={`${property.name} · ${property.configuration}`}
        title="Visit the site"
        aside={
          <Tag accent="mint" icon={CalendarDays}>
            <span className="tabular">{open.length}</span> open {open.length === 1 ? 'time' : 'times'}
          </Tag>
        }
      />

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(280px,360px)] items-start gap-5">
        <section aria-label="Visit times" className="flex flex-col gap-3">
          {days.map((day) => {
            const first = day.slots[0];
            if (!first) return null;
            const parts = dayParts(first.start);
            return (
              <div key={day.date} className="flex items-stretch gap-4 rounded-[16px] border-2 border-line bg-canvas p-3">
                <div className="grid w-14 shrink-0 place-items-center rounded-[12px] border-2 border-ink bg-mint-tint py-1 text-center">
                  <span className="text-[11px] font-bold uppercase tracking-[0.06em]">{parts.weekday}</span>
                  <span className="font-display text-2xl font-extrabold leading-none tabular">{parts.day}</span>
                  <span className="text-[11px] font-semibold text-ink-soft">{parts.month}</span>
                </div>
                <div className="flex min-w-0 flex-1 flex-col justify-center gap-2">
                  <p className="flex items-center gap-2 text-sm font-bold">
                    {day.label}
                    {isWeekendSlot(first) ? <Tag>Weekend</Tag> : null}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {day.slots.map((slot) => (
                      <SlotChip
                        key={slot.id}
                        slot={slot}
                        selected={slot.id === selected?.id}
                        yours={slot.id === bookedHere?.id}
                        onSelect={() => select(slot.id)}
                      />
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </section>

        <div className="sticky top-0 flex flex-col gap-3">
          {bookedHere ? (
            <Confirmed slot={bookedHere} property={property} />
          ) : (
            <Pending selected={selected} property={property} firstOpen={open[0] ?? null} onSelect={select} onConfirm={confirm} />
          )}
          {bookedHere && selected && selected.id !== bookedHere.id ? (
            <MoveVisit slot={selected} onConfirm={() => confirm(selected.id)} />
          ) : null}
          {otherBundle && otherSlot ? (
            <Notice
              tone="info"
              icon={CalendarDays}
              title={`You have a visit booked at ${otherBundle.property.name}`}
              body={`${describeSlot(otherSlot)}. Booking a visit here replaces it.`}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SlotChip({ slot, selected, yours, onSelect }: { slot: VisitSlot; selected: boolean; yours: boolean; onSelect: () => void }) {
  if (!slot.available) {
    return (
      <span
        aria-disabled
        title="This time is taken"
        className="inline-flex h-10 cursor-not-allowed items-center gap-1.5 rounded-[var(--radius-chip)] border-2 border-dashed border-line bg-paper px-3.5 text-sm font-semibold text-ink-mute"
      >
        <span className="line-through tabular">{formatSlotRange(slot)}</span>
        <span className="text-xs">Taken</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${describeSlot(slot)}${yours ? ', your booked visit' : ''}`}
      className={cn(
        'inline-flex h-10 items-center gap-1.5 rounded-[var(--radius-chip)] border-2 px-3.5 text-sm font-semibold',
        'transition-[transform,box-shadow,border-color,background-color] duration-100 ease-[var(--ease-snap)] active:translate-y-px',
        selected
          ? 'border-ink bg-mint text-ink shadow-[var(--shadow-pop-sm)]'
          : yours
            ? 'border-ink bg-mint-tint text-ink'
            : 'border-line bg-canvas text-ink hover:border-ink',
      )}
    >
      {selected || yours ? (
        <Check size={15} strokeWidth={ICON_STROKE} aria-hidden />
      ) : (
        <Clock size={15} strokeWidth={ICON_STROKE} aria-hidden className="text-mint-deep" />
      )}
      <span className="tabular">{formatSlotRange(slot)}</span>
      {yours ? <span className="text-xs">Your visit</span> : null}
    </button>
  );
}

function SlotDetails({ slot, property }: { slot: VisitSlot; property: Property }) {
  return (
    <>
      <p className="mt-1 font-display text-[26px] font-extrabold leading-tight">{formatSlotDay(slot.start)}</p>
      <p className="mt-1 flex items-center gap-1.5 text-[15px] font-semibold tabular">
        <Clock size={16} strokeWidth={ICON_STROKE} aria-hidden className="text-mint-deep" />
        {formatSlotRange(slot)}
        <span className="font-normal text-ink-soft">· about {durationMinutes(slot)} min</span>
      </p>
      <div className="mt-4 flex items-start gap-2 rounded-[12px] bg-paper px-3 py-2.5 text-sm">
        <MapPin size={16} strokeWidth={ICON_STROKE} aria-hidden className="mt-0.5 shrink-0 text-tangerine" />
        <div>
          <p className="font-bold">{property.name}</p>
          <p className="text-ink-soft">{property.address}</p>
        </div>
      </div>
    </>
  );
}

function Confirmed({ slot, property }: { slot: VisitSlot; property: Property }) {
  return (
    <Card as="section" className="bg-mint-tint p-5" aria-live="polite" aria-label="Visit confirmed">
      <p className="flex items-center gap-2 text-sm font-bold">
        <span aria-hidden className="grid h-7 w-7 place-items-center rounded-full border-2 border-ink bg-mint">
          <CircleCheckBig size={15} strokeWidth={ICON_STROKE} />
        </span>
        Your visit is booked
      </p>
      <SlotDetails slot={slot} property={property} />
      <p className="mt-3 text-xs text-ink-soft">To move it, pick another time on the left.</p>
    </Card>
  );
}

function Pending({
  selected,
  property,
  firstOpen,
  onSelect,
  onConfirm,
}: {
  selected: VisitSlot | null;
  property: Property;
  firstOpen: VisitSlot | null;
  onSelect: (slotId: string) => void;
  onConfirm: (slotId: string) => void;
}) {
  if (!firstOpen) {
    return (
      <Card as="section" className="p-5">
        <p className="flex items-center gap-2 font-bold">
          <CalendarX size={18} strokeWidth={ICON_STROKE} aria-hidden />
          No open times right now
        </p>
        <p className="mt-1 text-sm text-ink-soft">Every listed time is taken. Your advisor can ask for another slot that suits you.</p>
      </Card>
    );
  }
  if (!selected) {
    return (
      <Card as="section" className="p-5">
        <p className="text-sm font-semibold text-ink-soft">Your visit</p>
        <p className="mt-1 text-xl font-extrabold leading-tight">Pick a time that suits you</p>
        <p className="mt-1 text-sm text-ink-soft">Choose any open time on the left. Nothing is booked until you confirm.</p>
        <Button variant="secondary" size="sm" icon={Clock} className="mt-4" onClick={() => onSelect(firstOpen.id)}>
          Earliest: {formatSlotDayShort(firstOpen.start)}, {formatSlotTime(firstOpen.start)}
        </Button>
      </Card>
    );
  }
  if (!selected.available) {
    return (
      <Card as="section" className="p-5">
        <p className="flex items-center gap-2 font-bold">
          <CalendarX size={18} strokeWidth={ICON_STROKE} aria-hidden />
          That time is taken
        </p>
        <p className="mt-1 text-sm text-ink-soft">{describeSlot(selected)} is no longer open. Pick another time on the left.</p>
      </Card>
    );
  }
  return (
    <Card as="section" className="p-5" aria-label="Your visit">
      <p className="text-sm font-semibold text-ink-soft">Your visit</p>
      <SlotDetails slot={selected} property={property} />
      <Button variant="confirm" size="lg" icon={CalendarCheck} className="mt-5 w-full" onClick={() => onConfirm(selected.id)}>
        Confirm visit
      </Button>
      <p className="mt-2 text-center text-xs text-ink-soft">Confirming books this time for you.</p>
    </Card>
  );
}

function MoveVisit({ slot, onConfirm }: { slot: VisitSlot; onConfirm: () => void }) {
  if (!slot.available) {
    return <Notice tone="waiting" icon={CalendarX} title="That time is taken" body="Pick another open time to move your visit." />;
  }
  return (
    <Card as="section" elevation="flat" className="p-4" aria-label="Move your visit">
      <p className="text-sm font-semibold text-ink-soft">Move your visit to</p>
      <p className="mt-0.5 font-bold tabular">{describeSlot(slot)}</p>
      <Button variant="confirm" size="sm" icon={Repeat} className="mt-3" onClick={onConfirm}>
        Move my visit
      </Button>
    </Card>
  );
}

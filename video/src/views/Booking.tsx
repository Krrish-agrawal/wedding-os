import { C, FONT, OUTLINE } from '../brand';
import { BOOKING } from '../content';
import { pop, progress } from '../lib/anim';
import { Card, Icon } from '../ui/kit';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_PICK_AT = 10;
const SLOT_PICK_AT = 26;
const STAMP_AT = 42;

export function BookingView({ t }: { t: number }) {
  const first = new Date(BOOKING.year, BOOKING.monthIndex, 1).getDay();
  const days = new Date(BOOKING.year, BOOKING.monthIndex + 1, 0).getDate();
  const cells: Array<number | null> = [...Array.from({ length: first }, () => null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const dayPick = pop(t, DAY_PICK_AT);
  const slotPick = progress(t, SLOT_PICK_AT, SLOT_PICK_AT + 6);
  const stamp = pop(t, STAMP_AT, { damping: 11, stiffness: 220 });
  const pickedSlot = BOOKING.slots.findIndex((s) => s.pick);
  return (
    <div style={{ position: 'absolute', inset: 0, background: C.canvas, padding: '34px 44px', display: 'flex', gap: 40 }}>
      <Card style={{ width: 560, padding: '24px 26px' }} shadow={6}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontFamily: FONT.display, fontWeight: 800, fontSize: 36 }}>
          <Icon name="calendar" size={36} /> {BOOKING.monthLabel}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6, marginTop: 18 }}>
          {WEEKDAYS.map((d, i) => (
            <div key={i} style={{ textAlign: 'center', fontFamily: FONT.sans, fontWeight: 800, fontSize: 20, color: C.inkSoft, paddingBottom: 6 }}>
              {d}
            </div>
          ))}
          {cells.map((day, i) => {
            const picked = day === BOOKING.day;
            const today = day === BOOKING.today;
            return (
              <div key={i} style={{ height: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                {picked && (
                  <span style={{ position: 'absolute', width: 62, height: 62, borderRadius: '50%', background: C.blue, border: `${OUTLINE}px solid ${C.ink}`, transform: `scale(${dayPick})` }} />
                )}
                {today && <span style={{ position: 'absolute', width: 58, height: 58, borderRadius: '50%', border: `3px dashed ${C.inkSoft}` }} />}
                <span style={{ position: 'relative', fontFamily: FONT.sans, fontWeight: 700, fontSize: 26, color: picked && dayPick > 0.5 ? C.canvas : C.ink }}>{day ?? ''}</span>
              </div>
            );
          })}
        </div>
      </Card>
      <div style={{ flex: 1, position: 'relative' }}>
        <div style={{ fontFamily: FONT.display, fontWeight: 800, fontSize: 40, letterSpacing: '-0.02em', opacity: progress(t, DAY_PICK_AT, DAY_PICK_AT + 6) }}>{BOOKING.dayTitle}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 22 }}>
          {BOOKING.slots.map((slot, i) => {
            const enter = progress(t, DAY_PICK_AT + 4 + i * 3, DAY_PICK_AT + 12 + i * 3);
            const chosen = i === pickedSlot ? slotPick : 0;
            return (
              <div
                key={slot.label}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  height: 76,
                  padding: '0 24px',
                  borderRadius: 18,
                  border: `${OUTLINE}px solid ${C.ink}`,
                  background: chosen > 0 ? `color-mix(in srgb, ${C.blue} ${chosen * 100}%, ${C.canvas})` : slot.available ? C.canvas : C.paper,
                  boxShadow: chosen > 0 ? `${4 * chosen}px ${4 * chosen}px 0 0 ${C.ink}` : undefined,
                  opacity: enter,
                  transform: `translateX(${(1 - enter) * 30}px)`,
                  fontFamily: FONT.sans,
                  fontWeight: 800,
                  fontSize: 30,
                  color: !slot.available ? C.inkMute : chosen > 0.5 ? C.canvas : C.ink,
                  textDecoration: slot.available ? undefined : 'line-through',
                }}
              >
                {slot.label}
                {!slot.available && <span style={{ fontSize: 20, textDecoration: 'none' }}>{BOOKING.taken}</span>}
              </div>
            );
          })}
        </div>
        <div style={{ position: 'absolute', left: 30, bottom: 30, transform: `scale(${(1.5 - 0.5 * stamp) * stamp}) rotate(-6deg)`, opacity: Math.min(1, stamp * 3), transformOrigin: 'center' }}>
          <Card bg={C.mint} shadow={8} style={{ padding: '18px 28px', display: 'flex', alignItems: 'center', gap: 16 }}>
            <span style={{ display: 'flex', width: 58, height: 58, borderRadius: '50%', background: C.canvas, border: `3px solid ${C.ink}`, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="check" size={38} stroke={3.4} />
            </span>
            <div>
              <div style={{ fontFamily: FONT.display, fontWeight: 800, fontSize: 40, letterSpacing: '-0.02em' }}>{BOOKING.stamp}</div>
              <div style={{ fontFamily: FONT.sans, fontWeight: 700, fontSize: 24 }}>{BOOKING.stampDetail}</div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

import { C, FONT } from '../brand';
import { LEGAL } from '../content';
import { pop, progress } from '../lib/anim';
import { Chip, Icon } from '../ui/kit';

const ROW_AT = 2;
const ROW_STAGGER = 3;
const TICK_AT = 12;
const TICK_STAGGER = 6;

export function LegalView({ t }: { t: number }) {
  const ticked = LEGAL.docs.filter((d, i) => d.verified && t >= TICK_AT + i * TICK_STAGGER).length;
  const total = LEGAL.docs.length;
  return (
    <div style={{ position: 'absolute', inset: 0, background: C.canvas, padding: '30px 48px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontFamily: FONT.display, fontWeight: 800, fontSize: 44, letterSpacing: '-0.02em' }}>{LEGAL.title}</div>
        <Chip size={26} bg={C.mintTint}>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
            {ticked} of {total} {LEGAL.verified.toLowerCase()}
          </span>
        </Chip>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 22 }}>
        {LEGAL.docs.map((doc, i) => {
          const enter = progress(t, ROW_AT + i * ROW_STAGGER, ROW_AT + i * ROW_STAGGER + 8);
          const tickAt = TICK_AT + i * TICK_STAGGER;
          const done = t >= tickAt;
          const s = done ? pop(t, tickAt) : 1;
          return (
            <div
              key={doc.title}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 18,
                height: 66,
                padding: '0 18px 0 20px',
                borderRadius: 18,
                border: `3px solid ${C.ink}`,
                background: C.paper,
                opacity: enter,
                transform: `translateY(${(1 - enter) * 20}px)`,
              }}
            >
              <Icon name="doc" size={34} />
              <div style={{ flex: 1, fontFamily: FONT.sans, fontWeight: 700, fontSize: 28 }}>{doc.title}</div>
              <div style={{ transform: `scale(${s})` }}>
                {!done ? (
                  <Chip size={20} shadow={0} bg={C.canvas} color={C.inkMute}>
                    …
                  </Chip>
                ) : doc.verified ? (
                  <Chip size={20} shadow={2} bg={C.mint}>
                    <Icon name="check" size={22} stroke={3.4} /> {LEGAL.verified}
                  </Chip>
                ) : (
                  <Chip size={20} shadow={2} bg={C.sun}>
                    <Icon name="clock" size={22} stroke={3} /> {LEGAL.pending}
                  </Chip>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

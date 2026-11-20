import { C, FONT, OUTLINE } from '../brand';
import { CALL, PROPERTIES } from '../content';
import { pop, progress } from '../lib/anim';
import { Card, Chip } from '../ui/kit';
import { STAGE } from './stage';

/** An eight-storey apartment block with the fifth floor lit. */
function Building() {
  const ink = { stroke: C.ink, strokeWidth: OUTLINE, strokeLinejoin: 'round' as const };
  const floors = 8;
  const lit = 5;
  return (
    <svg width={220} height={220} viewBox="0 0 220 220">
      <rect x={50} y={20} width={120} height={196} rx={8} fill={C.blueTint} {...ink} />
      {Array.from({ length: floors }, (_, f) =>
        [0, 1, 2].map((c) => (
          <rect
            key={`${f}-${c}`}
            x={64 + c * 34}
            y={192 - f * 22 - 14}
            width={24}
            height={14}
            rx={3}
            fill={f + 1 === lit ? C.sun : C.canvas}
            stroke={C.ink}
            strokeWidth={2.5}
          />
        )),
      )}
      <path d="M20 216 L200 216" {...ink} />
      <circle cx={30} cy={186} r={22} fill={C.mint} {...ink} />
    </svg>
  );
}

/** A low garden studio with a big glass front. */
function Studio() {
  const ink = { stroke: C.ink, strokeWidth: OUTLINE, strokeLinejoin: 'round' as const };
  return (
    <svg width={220} height={220} viewBox="0 0 220 220">
      <path d="M30 216 L30 100 L110 60 L190 100 L190 216 Z" fill={C.sunTint} {...ink} />
      <rect x={52} y={120} width={116} height={70} rx={6} fill={C.blueTint} {...ink} />
      <path d="M90 120 L90 190 M130 120 L130 190" {...ink} strokeWidth={3} />
      <path d="M10 216 L210 216" {...ink} />
      <circle cx={196} cy={184} r={24} fill={C.mint} {...ink} />
      <circle cx={24} cy={190} r={18} fill={C.mint} {...ink} />
    </svg>
  );
}

const CARD_W = 500;

/** The two sample homes. Larkspur Court gets picked when the buyer asks for it. */
export function PickerView({ t, selectAt }: { t: number; selectAt: number }) {
  const picked = progress(t, selectAt, selectAt + 10);
  const homes = [
    { p: PROPERTIES.sale, art: <Building />, tint: C.blueTint },
    { p: PROPERTIES.lease, art: <Studio />, tint: C.sunTint },
  ];
  return (
    <div style={{ position: 'absolute', inset: 0, padding: '36px 44px' }}>
      <div style={{ fontFamily: FONT.display, fontWeight: 800, fontSize: 46, letterSpacing: '-0.02em' }}>{CALL.pickerTitle}</div>
      <div style={{ display: 'flex', gap: 44, marginTop: 30 }}>
        {homes.map(({ p, art, tint }, i) => {
          const chosen = i === 0;
          const s = chosen ? 1 + 0.04 * picked : 1 - 0.04 * picked;
          return (
            <div key={p.name} style={{ transform: `scale(${s})`, opacity: chosen ? 1 : 1 - 0.45 * picked, transformOrigin: 'center' }}>
              <Card
                style={{ width: CARD_W, height: STAGE.h - 170, overflow: 'hidden' }}
                shadow={chosen ? 8 + 4 * picked : 8}
                bg={chosen && picked > 0 ? `color-mix(in srgb, ${C.blueTint} ${picked * 100}%, ${C.canvas})` : C.canvas}
              >
                <div style={{ height: 250, background: tint, borderBottom: `${OUTLINE}px solid ${C.ink}`, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                  {art}
                </div>
                <div style={{ padding: '22px 28px' }}>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <Chip size={20} shadow={0} bg={chosen ? C.mintTint : C.grapeTint}>
                      {p.kind}
                    </Chip>
                    <Chip size={20} shadow={0}>
                      {p.locality}
                    </Chip>
                  </div>
                  <div style={{ fontFamily: FONT.display, fontWeight: 800, fontSize: 40, letterSpacing: '-0.02em', marginTop: 16 }}>{p.name}</div>
                  <div style={{ fontFamily: FONT.sans, fontWeight: 600, fontSize: 22, color: C.inkSoft, marginTop: 4 }}>{p.config}</div>
                  <div style={{ fontFamily: FONT.display, fontWeight: 800, fontSize: 44, marginTop: 14, color: C.blueDeep }}>{p.price}</div>
                </div>
              </Card>
              {chosen && (
                <div style={{ position: 'absolute', right: -18, top: -22, transform: `scale(${pop(t, selectAt + 4)}) rotate(8deg)` }}>
                  <Chip bg={C.sun} size={24}>
                    {CALL.opening}
                  </Chip>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

import { C, FONT } from '../brand';
import { PRICING, PROPERTIES } from '../content';
import { inr, monthlyEmi } from '../lib/money';
import { pop, progress, SMOOTH } from '../lib/anim';
import { Card, Chip, Icon } from '../ui/kit';

const EMI = monthlyEmi({ price: PROPERTIES.sale.priceRupees, ...PRICING.emi });

export function PricingView({ t }: { t: number }) {
  const roll = progress(t, 10, 42, SMOOTH);
  const p = PROPERTIES.sale;
  return (
    <div style={{ position: 'absolute', inset: 0, background: C.canvas, padding: '40px 48px', display: 'flex', gap: 48 }}>
      <div style={{ width: 590 }}>
        <div style={{ fontFamily: FONT.sans, fontWeight: 700, fontSize: 26, color: C.inkSoft }}>
          {p.name} · {p.locality}
        </div>
        <div style={{ fontFamily: FONT.display, fontWeight: 800, fontSize: 132, letterSpacing: '-0.04em', lineHeight: 1, marginTop: 8 }}>{inr(p.priceRupees)}</div>
        <div style={{ fontFamily: FONT.sans, fontWeight: 600, fontSize: 26, color: C.inkSoft, marginTop: 10 }}>{PRICING.allIn}</div>
        <Card bg={C.blueTint} style={{ marginTop: 34, padding: '26px 30px' }}>
          <div style={{ fontFamily: FONT.sans, fontWeight: 700, fontSize: 26, color: C.inkSoft }}>{PRICING.emiLabel}</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginTop: 4 }}>
            <span style={{ fontFamily: FONT.display, fontWeight: 800, fontSize: 96, letterSpacing: '-0.03em', color: C.blueDeep, fontVariantNumeric: 'tabular-nums' }}>{inr(Math.max(1e5, EMI * roll))}</span>
            <span style={{ fontFamily: FONT.sans, fontWeight: 700, fontSize: 30, color: C.inkSoft }}>{PRICING.perMonth}</span>
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 14 }}>
            {[`${PRICING.emi.downPaymentPct}% down`, `${PRICING.emi.ratePct}%`, `${PRICING.emi.tenureYears} years`].map((label, i) => (
              <div key={label} style={{ transform: `scale(${pop(t, 4 + i * 4)})` }}>
                <Chip size={22} shadow={2}>
                  {label}
                </Chip>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <div style={{ flex: 1, paddingTop: 6 }}>
        <div style={{ fontFamily: FONT.display, fontWeight: 800, fontSize: 40, letterSpacing: '-0.02em' }}>{PRICING.offersTitle}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22, marginTop: 26 }}>
          {PRICING.offers.map((offer, i) => {
            const s = pop(t, 30 + i * 9);
            return (
              <div key={offer} style={{ transform: `scale(${(2 - s) * s}) rotate(${(1 - s) * -10}deg)`, transformOrigin: 'left center', opacity: Math.min(1, s * 2) }}>
                <Card bg={C.mintTint} shadow={6} style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '20px 24px' }}>
                  <span style={{ display: 'flex', width: 52, height: 52, borderRadius: '50%', background: C.mint, border: `3px solid ${C.ink}`, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="check" size={32} stroke={3.2} />
                  </span>
                  <span style={{ fontFamily: FONT.sans, fontWeight: 800, fontSize: 30, lineHeight: 1.2 }}>{offer}</span>
                </Card>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

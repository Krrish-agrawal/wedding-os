import { useMemo } from 'react';
import { TriangleExclamationPoint } from 'lucide-react';
import {
  amortizationByYear,
  formatINR,
  formatINRShort,
  speakINR,
  type AmortizationYear,
  type EmiInputs,
  type EmiResult,
  type LoanCheck,
  type SaleMoney,
} from '@ave/shared';
import { Card, CountUp, Notice } from '@/ui';
import { EstimateNote, FigureRow, SourceLink } from './parts';
import { Slider } from './Slider';

/** Slider ranges. Values the advisor sets outside them widen the range rather than being clipped. */
const DOWN_PAYMENT_MIN_SHARE = 0.1;
const DOWN_PAYMENT_MAX_SHARE = 0.9;
const DOWN_PAYMENT_STEP_INR = 50_000;
const RATE_MIN_PCT = 6.5;
const RATE_MAX_PCT = 12;
const RATE_STEP_PCT = 0.05;
const TENURE_MIN_YEARS = 5;
const TENURE_MAX_YEARS = 30;

function formatRate(pct: number): string {
  return `${Number(pct.toFixed(2))}%`;
}

function share(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

interface EmiTabProps {
  money: SaleMoney;
  price: number;
  inputs: EmiInputs;
  emi: EmiResult;
  ltv: LoanCheck | null;
  onChange: (patch: Partial<EmiInputs>) => void;
}

/** EMI calculator: three sliders and where the money goes over the life of the loan. */
export function EmiTab({ money, price, inputs, emi, ltv, onChange }: EmiTabProps) {
  const downMin = Math.min(Math.floor((price * DOWN_PAYMENT_MIN_SHARE) / DOWN_PAYMENT_STEP_INR) * DOWN_PAYMENT_STEP_INR, inputs.downPayment);
  const downMax = Math.max(Math.ceil((price * DOWN_PAYMENT_MAX_SHARE) / DOWN_PAYMENT_STEP_INR) * DOWN_PAYMENT_STEP_INR, inputs.downPayment);
  const rateMin = Math.min(RATE_MIN_PCT, inputs.ratePct);
  const rateMax = Math.max(RATE_MAX_PCT, inputs.ratePct);
  const tenureMin = Math.min(TENURE_MIN_YEARS, inputs.tenureYears);

  const rows = useMemo(
    () => amortizationByYear(emi.loanAmount, inputs.ratePct, inputs.tenureYears),
    [emi.loanAmount, inputs.ratePct, inputs.tenureYears],
  );

  return (
    <div className="flex flex-col gap-4">
      <Card elevation="flat" className="flex flex-col gap-5 p-5">
        <Slider
          label="Down payment"
          display={formatINRShort(inputs.downPayment)}
          hint={`${share(inputs.downPayment, price)}% of your price`}
          min={downMin}
          max={downMax}
          step={DOWN_PAYMENT_STEP_INR}
          value={inputs.downPayment}
          valueText={speakINR(inputs.downPayment)}
          minLabel={formatINRShort(downMin)}
          maxLabel={formatINRShort(downMax)}
          onChange={(downPayment) => onChange({ downPayment })}
        />
        <Slider
          label="Interest rate"
          display={formatRate(inputs.ratePct)}
          hint="a year, floating"
          min={rateMin}
          max={rateMax}
          step={RATE_STEP_PCT}
          value={inputs.ratePct}
          valueText={`${formatRate(inputs.ratePct)} a year`}
          minLabel={formatRate(rateMin)}
          maxLabel={formatRate(rateMax)}
          onChange={(ratePct) => onChange({ ratePct: Number(ratePct.toFixed(2)) })}
        />
        <Slider
          label="Loan tenure"
          display={`${inputs.tenureYears} years`}
          hint={`${emi.months} monthly EMIs`}
          min={tenureMin}
          max={TENURE_MAX_YEARS}
          step={1}
          value={inputs.tenureYears}
          valueText={`${inputs.tenureYears} years`}
          minLabel={`${tenureMin} yrs`}
          maxLabel={`${TENURE_MAX_YEARS} yrs`}
          onChange={(tenureYears) => onChange({ tenureYears })}
        />
        {money.emiDefaults.rateNote ? (
          <EstimateNote>
            {money.emiDefaults.rateNote} {money.emiDefaults.rateSource ? <SourceLink href={money.emiDefaults.rateSource} /> : null}
          </EstimateNote>
        ) : null}
      </Card>

      {ltv && !ltv.withinLimit && emi.loanAmount > 0 ? (
        <Notice
          tone="warn"
          icon={TriangleExclamationPoint}
          title="Banks will want a larger down payment"
          body={
            <>
              On a loan this size, banks lend up to {ltv.capPct}% of the home's cost ({formatINRShort(ltv.propertyValue)}), and stamp duty,
              registration and deposits come from you. Plan for at least {formatINRShort(ltv.minDownPayment)} down.{' '}
              <SourceLink href={ltv.source} label="RBI rule" />
            </>
          }
        />
      ) : null}

      <Card elevation="flat" className="p-5">
        <h3 className="text-lg font-extrabold leading-tight">Principal and interest</h3>
        {emi.loanAmount > 0 ? (
          <PrincipalInterest emi={emi} rows={rows} />
        ) : (
          <p className="mt-2 text-sm text-ink-soft">Your down payment covers the whole price, so there is no loan and no interest.</p>
        )}
      </Card>
    </div>
  );
}

const CHART_HEIGHT = 120;
const BAR_GAP_SHARE = 0.25;

function PrincipalInterest({ emi, rows }: { emi: EmiResult; rows: AmortizationYear[] }) {
  const principalShare = share(emi.loanAmount, emi.totalPayable);
  const tallest = Math.max(1, ...rows.map((r) => r.principal + r.interest));
  const slot = 100 / Math.max(1, rows.length);
  const barWidth = slot * (1 - BAR_GAP_SHARE);
  const crossover = rows.find((r) => r.principal > r.interest)?.year ?? null;
  const midYear = rows[Math.floor((rows.length - 1) / 2)]?.year;

  return (
    <div className="mt-3 flex flex-col gap-4">
      <div>
        <div className="flex h-5 overflow-hidden rounded-full border-2 border-ink" role="img" aria-label={`Principal ${principalShare}%, interest ${100 - principalShare}%`}>
          <div className="h-full bg-coral" style={{ width: `${principalShare}%` }} />
          <div className="h-full border-l-2 border-ink bg-ink" style={{ width: `${100 - principalShare}%` }} />
        </div>
        <dl className="mt-2 grid grid-cols-2 gap-3 text-sm">
          <LegendItem swatch="bg-coral" label="Principal" value={emi.loanAmount} pct={principalShare} />
          <LegendItem swatch="bg-ink" label="Interest" value={emi.totalInterest} pct={100 - principalShare} />
        </dl>
      </div>

      <figure>
        <svg
          viewBox={`0 0 100 ${CHART_HEIGHT}`}
          preserveAspectRatio="none"
          className="block h-[120px] w-full"
          role="img"
          aria-label="Principal and interest paid in each year of the loan"
        >
          {rows.map((r, i) => {
            const x = i * slot + (slot - barWidth) / 2;
            const ph = (r.principal / tallest) * CHART_HEIGHT;
            const ih = (r.interest / tallest) * CHART_HEIGHT;
            return (
              <g key={r.year}>
                <title>{`Year ${r.year}: principal ${formatINR(r.principal)}, interest ${formatINR(r.interest)}`}</title>
                <rect x={x} y={CHART_HEIGHT - ph - ih} width={barWidth} height={ih} fill="var(--color-ink)" />
                <rect x={x} y={CHART_HEIGHT - ph} width={barWidth} height={ph} fill="var(--color-coral)" />
              </g>
            );
          })}
        </svg>
        <div aria-hidden className="mt-1 flex justify-between text-[11px] font-semibold text-ink-soft tabular">
          <span>Year 1</span>
          {midYear && midYear !== 1 ? <span>Year {midYear}</span> : null}
          <span>Year {rows.length}</span>
        </div>
        <figcaption className="mt-2 text-sm text-ink-soft">
          {crossover && crossover > 1
            ? `Early EMIs go mostly to interest. From year ${crossover}, most of each EMI pays down the loan.`
            : 'Most of each EMI pays down the loan from the first year.'}
        </figcaption>
      </figure>
    </div>
  );
}

function LegendItem({ swatch, label, value, pct }: { swatch: string; label: string; value: number; pct: number }) {
  return (
    <div className="flex items-start gap-2">
      <span aria-hidden className={`mt-1 h-3 w-3 shrink-0 rounded-[4px] border-2 border-ink ${swatch}`} />
      <div>
        <dt className="text-xs font-semibold text-ink-soft">
          {label} · {pct}%
        </dt>
        <dd className="font-bold tabular">
          <CountUp value={value} format={formatINRShort} />
        </dd>
      </div>
    </div>
  );
}

/** The EMI summary card that sits beside the calculator. */
export function EmiSummary({ inputs, emi, price }: { inputs: EmiInputs; emi: EmiResult; price: number }) {
  return (
    <Card as="aside" className="flex flex-col p-5">
      <p className="text-sm font-semibold text-ink-soft">Monthly EMI</p>
      <p className="mt-1 font-display text-[40px] font-extrabold leading-none tracking-[-0.02em]">
        <CountUp value={emi.monthlyEmi} format={formatINR} />
      </p>
      <p className="mt-1.5 text-sm text-ink-soft">
        {emi.loanAmount > 0 ? `for ${inputs.tenureYears} years at ${formatRate(inputs.ratePct)} a year` : 'No loan needed at this down payment'}
      </p>
      <dl className="mt-4 divide-y-2 divide-line border-y-2 border-line">
        <FigureRow label="Your price" value={formatINR(price)} />
        <FigureRow label="Down payment" value={formatINR(Math.min(inputs.downPayment, price))} />
        <FigureRow label="Loan amount" value={<CountUp value={emi.loanAmount} format={formatINR} />} emphasis />
        <FigureRow label="Interest over the loan" value={<CountUp value={emi.totalInterest} format={formatINR} />} />
        <FigureRow label="Total you repay" value={<CountUp value={emi.totalPayable} format={formatINR} />} />
      </dl>
      <EstimateNote className="mt-auto pt-4">
        Indicative EMI on a reducing balance, on your price after offers. Your bank sets the final rate and loan amount.
      </EstimateNote>
    </Card>
  );
}

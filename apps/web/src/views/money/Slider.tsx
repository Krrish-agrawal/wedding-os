import { useId, type ReactNode } from 'react';
import { cn } from '@/ui';

interface SliderProps {
  label: string;
  /** Large value shown next to the label. */
  display: ReactNode;
  /** One quiet line under the value, e.g. "35% of your price". */
  hint?: ReactNode;
  min: number;
  max: number;
  step: number;
  value: number;
  /** Spoken value for screen readers, e.g. "74 lakh rupees". */
  valueText: string;
  minLabel: string;
  maxLabel: string;
  onChange: (value: number) => void;
}

/**
 * A range input drawn in the product's language: ink-outlined track, coral fill, white thumb on a hard shadow.
 * The native input stays on top (transparent) so keyboard, touch and screen readers work as usual.
 */
export function Slider({ label, display, hint, min, max, step, value, valueText, minLabel, maxLabel, onChange }: SliderProps) {
  const id = useId();
  const clamped = Math.min(max, Math.max(min, value));
  const pct = max > min ? ((clamped - min) / (max - min)) * 100 : 0;
  const thumbLeft = `calc(${pct} * (100% - 24px) / 100 + 12px)`;

  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <label htmlFor={id} className="pb-0.5 text-sm font-semibold text-ink">
          {label}
        </label>
        <div className="text-right">
          <span className="font-display text-2xl font-extrabold leading-none tabular">{display}</span>
          {hint ? <span className="block text-xs text-ink-soft tabular">{hint}</span> : null}
        </div>
      </div>
      <div className="relative mt-2 h-8">
        <div aria-hidden className="absolute inset-x-0 top-1/2 h-3 -translate-y-1/2 overflow-hidden rounded-full border-2 border-ink bg-paper">
          <div className="h-full bg-coral" style={{ width: thumbLeft }} />
        </div>
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={clamped}
          aria-valuetext={valueText}
          onChange={(e) => onChange(Number(e.target.value))}
          className={cn(
            'peer absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent opacity-0',
            '[&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:appearance-none',
            '[&::-moz-range-thumb]:h-6 [&::-moz-range-thumb]:w-6',
          )}
        />
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink bg-canvas shadow-[var(--shadow-pop-sm)]',
            'transition-transform duration-100 peer-active:scale-110',
            'peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2 peer-focus-visible:outline-blue peer-focus-visible:outline-solid',
          )}
          style={{ left: thumbLeft }}
        />
      </div>
      <div aria-hidden className="mt-0.5 flex justify-between text-[11px] font-semibold text-ink-soft tabular">
        <span>{minLabel}</span>
        <span>{maxLabel}</span>
      </div>
    </div>
  );
}

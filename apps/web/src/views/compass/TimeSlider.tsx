import { Sunrise, Sunset } from 'lucide-react';
import { formatClock } from '@ave/shared';
import { ICON_STROKE } from '@/ui/icons';
import { cn } from '@/ui/cn';

/** Diameter of the slider thumb, px; positions on the track allow for it. */
const THUMB_PX = 24;
const HOUR_MIN = 60;
/** Hour labels under the track, every this many hours. */
const LABEL_EVERY_H = 3;

interface TimeSliderProps {
  value: number;
  min: number;
  max: number;
  step: number;
  sunriseMin: number;
  sunsetMin: number;
  onChange: (minutes: number) => void;
  /** Pointer pressed or released on the slider. */
  onDragChange: (dragging: boolean) => void;
}

/** Where a minute value sits along the track, accounting for the thumb's width. */
function at(v: number, min: number, max: number): string {
  const f = Math.min(1, Math.max(0, (v - min) / (max - min)));
  return `calc(${THUMB_PX / 2}px + ${f.toFixed(4)} * (100% - ${THUMB_PX}px))`;
}

/** Time-of-day slider with the daylight span marked on its track. */
export function TimeSlider({ value, min, max, step, sunriseMin, sunsetMin, onChange, onDragChange }: TimeSliderProps) {
  const clamped = Math.min(max, Math.max(min, value));
  const hours: number[] = [];
  for (let m = Math.ceil(min / (HOUR_MIN * LABEL_EVERY_H)) * HOUR_MIN * LABEL_EVERY_H; m <= max; m += HOUR_MIN * LABEL_EVERY_H) hours.push(m);
  const isDay = value >= sunriseMin && value <= sunsetMin;

  return (
    <div className="flex items-center gap-5 border-t-2 border-line bg-canvas px-5 pb-3 pt-3">
      <div className="w-[118px] shrink-0">
        <p className="text-xs font-bold uppercase tracking-[0.08em] text-ink-soft">Time of day</p>
        <p className="font-display text-[26px] font-bold leading-tight tabular" aria-hidden>
          {formatClock(value)}
        </p>
      </div>
      <div className="relative h-[52px] min-w-0 flex-1">
        <div className="absolute inset-x-0 top-[13px] h-3.5 overflow-hidden rounded-full border-2 border-ink bg-paper">
          <div
            className="absolute inset-y-0 bg-sun"
            style={{ left: at(sunriseMin, min, max), width: `calc(${at(sunsetMin, min, max)} - ${at(sunriseMin, min, max)})` }}
          />
        </div>
        {[
          { m: sunriseMin, Icon: Sunrise, label: 'Sunrise' },
          { m: sunsetMin, Icon: Sunset, label: 'Sunset' },
        ].map(({ m, Icon, label }) => (
          <span key={label} className="pointer-events-none absolute top-[-6px] -translate-x-1/2 text-sun-deep" style={{ left: at(m, min, max) }} title={`${label} ${formatClock(m)}`}>
            <Icon size={14} strokeWidth={ICON_STROKE} aria-hidden />
          </span>
        ))}
        {hours.map((m) => (
          <span key={m} className="pointer-events-none absolute top-[33px] -translate-x-1/2 whitespace-nowrap text-[11px] font-semibold text-ink-soft tabular" style={{ left: at(m, min, max) }}>
            {formatClock(m).replace(':00', '')}
          </span>
        ))}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={clamped}
          aria-label="Time of day"
          aria-valuetext={`${formatClock(value)}${isDay ? '' : ', sun down'}`}
          onChange={(e) => onChange(Number(e.target.value))}
          onPointerDown={() => onDragChange(true)}
          onPointerUp={() => onDragChange(false)}
          onPointerCancel={() => onDragChange(false)}
          onBlur={() => onDragChange(false)}
          className={cn(
            'absolute inset-x-0 top-[7px] h-[26px] w-full cursor-pointer appearance-none bg-transparent outline-none',
            '[&::-webkit-slider-runnable-track]:h-[26px] [&::-webkit-slider-runnable-track]:bg-transparent',
            '[&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full',
            '[&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-ink [&::-webkit-slider-thumb]:bg-canvas [&::-webkit-slider-thumb]:shadow-[var(--shadow-pop-sm)]',
            '[&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-ink [&::-moz-range-thumb]:bg-canvas',
            'focus-visible:[&::-webkit-slider-thumb]:outline-3 focus-visible:[&::-webkit-slider-thumb]:outline-blue',
          )}
        />
      </div>
    </div>
  );
}

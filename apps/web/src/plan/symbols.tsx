import type { ReactNode } from 'react';
import type { ElectricalKind, PlumbingKind, PlumbingLineKind } from '@ave/shared';
import { cn } from '@/ui/cn';
import { clamp } from './geometry';

/**
 * One symbol set for the plan layers, drawn as small SVG glyphs centred on (0, 0).
 * Every glyph uses the same 1.5px ink outline and a few token fills: grape for power, sun for light,
 * blue for water and cooling, coral for heat, mint for data.
 */

const SW = 1.5;
const SW_THIN = 1.1;

/** Symbol size in px for a plan drawn at `scale` px per metre. */
export function symbolSize(scale: number): number {
  return clamp(scale * SYMBOL_METRES, SYMBOL_MIN_PX, SYMBOL_MAX_PX);
}
/** A symbol stands for roughly this many metres on the plan, within readable limits. */
const SYMBOL_METRES = 0.32;
const SYMBOL_MIN_PX = 13;
const SYMBOL_MAX_PX = 22;

function pins(s: number, r: number) {
  return (
    <>
      <circle cx={0} cy={-s * 0.15} r={r} className="fill-ink" />
      <circle cx={-s * 0.13} cy={s * 0.1} r={r} className="fill-ink" />
      <circle cx={s * 0.13} cy={s * 0.1} r={r} className="fill-ink" />
    </>
  );
}

function bolt(s: number, cls: string) {
  const d = `M${0.06 * s} ${-0.3 * s}L${-0.17 * s} ${0.05 * s}H${0}L${-0.05 * s} ${0.3 * s}L${0.18 * s} ${-0.06 * s}H${0.01 * s}Z`;
  return <path d={d} className={cls} strokeWidth={SW_THIN} strokeLinejoin="round" />;
}

export function ElectricalGlyph({ kind, s }: { kind: ElectricalKind; s: number }) {
  switch (kind) {
    case 'light': {
      const r = s * 0.42;
      const k = r * Math.SQRT1_2;
      return (
        <>
          <circle r={r} className="fill-sun stroke-ink" strokeWidth={SW} />
          <path d={`M${-k} ${-k}L${k} ${k}M${k} ${-k}L${-k} ${k}`} className="stroke-ink" strokeWidth={SW_THIN} />
        </>
      );
    }
    case 'fan':
      return (
        <>
          <circle r={s * 0.46} className="fill-canvas stroke-ink" strokeWidth={SW} />
          {[0, 120, 240].map((a) => (
            <ellipse key={a} cx={0} cy={-s * 0.2} rx={s * 0.09} ry={s * 0.19} transform={`rotate(${a})`} className="fill-grape" />
          ))}
          <circle r={s * 0.07} className="fill-ink" />
        </>
      );
    case 'socket':
      return (
        <>
          <circle r={s * 0.4} className="fill-canvas stroke-ink" strokeWidth={SW} />
          {pins(s, s * 0.06)}
        </>
      );
    case 'power_socket':
      return (
        <>
          <circle r={s * 0.45} className="fill-grape stroke-ink" strokeWidth={SW} />
          {pins(s, s * 0.08)}
        </>
      );
    case 'ac':
      return (
        <>
          <rect x={-s * 0.62} y={-s * 0.3} width={s * 1.24} height={s * 0.6} rx={s * 0.12} className="fill-blue-tint stroke-ink" strokeWidth={SW} />
          <path d={`M${-s * 0.4} ${-s * 0.04}H${s * 0.4}M${-s * 0.4} ${s * 0.13}H${s * 0.4}`} className="stroke-blue-deep" strokeWidth={SW_THIN} strokeLinecap="round" />
        </>
      );
    case 'data':
      return <path d={`M0 ${-s * 0.46}L${s * 0.43} ${s * 0.34}H${-s * 0.43}Z`} className="fill-mint stroke-ink" strokeWidth={SW} strokeLinejoin="round" />;
    case 'switchboard':
      return (
        <>
          <rect x={-s * 0.46} y={-s * 0.3} width={s * 0.92} height={s * 0.6} rx={s * 0.1} className="fill-ink" />
          <rect x={-s * 0.3} y={-s * 0.14} width={s * 0.22} height={s * 0.28} rx={s * 0.04} className="fill-canvas" />
          <rect x={s * 0.08} y={-s * 0.14} width={s * 0.22} height={s * 0.28} rx={s * 0.04} className="fill-canvas" />
        </>
      );
    case 'db':
      return (
        <>
          <rect x={-s * 0.62} y={-s * 0.44} width={s * 1.24} height={s * 0.88} rx={s * 0.1} className="fill-grape stroke-ink" strokeWidth={SW + 0.5} />
          {bolt(s, 'fill-canvas stroke-ink')}
        </>
      );
    case 'ev': {
      const r = s * 0.46;
      const hex = Array.from({ length: 6 }, (_, i) => {
        const a = (Math.PI / 3) * i;
        return `${(r * Math.sin(a)).toFixed(2)} ${(-r * Math.cos(a)).toFixed(2)}`;
      });
      return (
        <>
          <path d={`M${hex.join('L')}Z`} className="fill-mint stroke-ink" strokeWidth={SW} strokeLinejoin="round" />
          {bolt(s, 'fill-ink stroke-ink')}
        </>
      );
    }
  }
}

export function PlumbingGlyph({ kind, s }: { kind: PlumbingKind; s: number }) {
  switch (kind) {
    case 'wc':
      return (
        <>
          <rect x={-s * 0.4} y={-s * 0.52} width={s * 0.8} height={s * 0.28} rx={s * 0.06} className="fill-canvas stroke-ink" strokeWidth={SW} />
          <ellipse cx={0} cy={s * 0.12} rx={s * 0.32} ry={s * 0.38} className="fill-canvas stroke-ink" strokeWidth={SW} />
        </>
      );
    case 'basin':
      return (
        <>
          <rect x={-s * 0.5} y={-s * 0.36} width={s} height={s * 0.72} rx={s * 0.14} className="fill-canvas stroke-ink" strokeWidth={SW} />
          <ellipse cx={0} cy={s * 0.04} rx={s * 0.31} ry={s * 0.19} className="fill-blue-tint stroke-ink" strokeWidth={SW_THIN} />
        </>
      );
    case 'shower': {
      const h = s * 0.48;
      return (
        <>
          <rect x={-h} y={-h} width={2 * h} height={2 * h} rx={s * 0.06} className="fill-blue-tint stroke-ink" strokeWidth={SW} />
          <path d={`M${-h} ${-h}L${h} ${h}M${h} ${-h}L${-h} ${h}`} className="stroke-blue" strokeWidth={SW_THIN} />
          <circle r={s * 0.1} className="fill-canvas stroke-ink" strokeWidth={SW_THIN} />
        </>
      );
    }
    case 'sink':
      return (
        <>
          <rect x={-s * 0.56} y={-s * 0.38} width={s * 1.12} height={s * 0.76} rx={s * 0.08} className="fill-canvas stroke-ink" strokeWidth={SW} />
          <rect x={-s * 0.4} y={-s * 0.2} width={s * 0.8} height={s * 0.48} rx={s * 0.1} className="fill-blue-tint stroke-ink" strokeWidth={SW_THIN} />
          <circle cx={0} cy={-s * 0.29} r={s * 0.05} className="fill-ink" />
        </>
      );
    case 'washing_machine': {
      const h = s * 0.46;
      return (
        <>
          <rect x={-h} y={-h} width={2 * h} height={2 * h} rx={s * 0.1} className="fill-canvas stroke-ink" strokeWidth={SW} />
          <circle cy={s * 0.05} r={s * 0.27} className="fill-blue-tint stroke-ink" strokeWidth={SW_THIN} />
        </>
      );
    }
    case 'water_heater':
      return (
        <>
          <circle r={s * 0.43} className="fill-coral-tint stroke-ink" strokeWidth={SW} />
          <path
            d={`M${-s * 0.25} ${s * 0.06}L${-s * 0.12} ${-s * 0.1}L0 ${s * 0.1}L${s * 0.12} ${-s * 0.1}L${s * 0.25} ${s * 0.06}`}
            className="fill-none stroke-coral-deep"
            strokeWidth={SW}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </>
      );
    case 'shaft': {
      const h = s * 0.55;
      return (
        <>
          <rect x={-h} y={-h} width={2 * h} height={2 * h} className="fill-paper stroke-ink" strokeWidth={SW + 0.5} />
          <path d={`M${-h} ${-h}L${h} ${h}M${h} ${-h}L${-h} ${h}`} className="stroke-ink" strokeWidth={SW_THIN} />
        </>
      );
    }
    case 'floor_trap': {
      const r = s * 0.3;
      return (
        <>
          <circle r={r} className="fill-canvas stroke-ink" strokeWidth={SW} />
          <path d={`M${-r} 0H${r}M0 ${-r}V${r}`} className="stroke-ink" strokeWidth={SW_THIN} />
        </>
      );
    }
    case 'tap':
      return (
        <>
          <path d={`M0 ${-s * 0.16}V${-s * 0.4}M${-s * 0.16} ${-s * 0.4}H${s * 0.16}`} className="stroke-ink" strokeWidth={SW} strokeLinecap="round" />
          <circle r={s * 0.19} className="fill-blue stroke-ink" strokeWidth={SW} />
        </>
      );
  }
}

export type RunKind = 'circuit' | PlumbingLineKind;

/** Stroke style per run kind. Drains are dashed and heavier, like a drawn plan. */
export const RUN_STYLE: Record<RunKind, { className: string; width: number; dash?: string }> = {
  circuit: { className: 'stroke-grape', width: 2 },
  cold: { className: 'stroke-blue', width: 2.5 },
  hot: { className: 'stroke-coral', width: 2.5 },
  drain: { className: 'stroke-ink-soft', width: 3, dash: '7 5' },
};

/** A small standalone SVG holding one glyph, for legends and lists. */
export function Swatch({ children, size = 24 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`} aria-hidden className="shrink-0 overflow-visible">
      {children}
    </svg>
  );
}

export function RunSwatch({ kind, size = 24 }: { kind: RunKind; size?: number }) {
  const st = RUN_STYLE[kind];
  return (
    <Swatch size={size}>
      <path d={`M${-size / 2 + 2} 0H${size / 2 - 2}`} className={cn('fill-none', st.className)} strokeWidth={st.width} strokeDasharray={st.dash} strokeLinecap="round" />
    </Swatch>
  );
}

/** Glyph size used in legends and lists. */
export const SWATCH_GLYPH = 17;

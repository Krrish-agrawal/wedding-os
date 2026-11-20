import type { CSSProperties, ReactNode } from 'react';
import { C, FONT, OUTLINE, pop, RADIUS } from '../brand';

/** A brand card: ink outline, rounded corners and a hard offset shadow. */
export function Card({
  children,
  style,
  bg = C.canvas,
  shadow = 8,
  radius = RADIUS.card,
}: {
  children?: ReactNode;
  style?: CSSProperties;
  bg?: string;
  shadow?: number;
  radius?: number;
}) {
  return (
    <div
      style={{
        background: bg,
        border: `${OUTLINE}px solid ${C.ink}`,
        borderRadius: radius,
        boxShadow: shadow ? pop(shadow) : undefined,
        position: 'relative',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** A pill with an ink outline. */
export function Chip({
  children,
  bg = C.canvas,
  color = C.ink,
  dot,
  size = 30,
  shadow = 4,
  style,
}: {
  children: ReactNode;
  bg?: string;
  color?: string;
  dot?: string;
  size?: number;
  shadow?: number;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: size * 0.4,
        padding: `${size * 0.32}px ${size * 0.7}px`,
        borderRadius: RADIUS.chip,
        border: `${Math.max(3, OUTLINE - 1)}px solid ${C.ink}`,
        background: bg,
        color,
        fontFamily: FONT.sans,
        fontWeight: 700,
        fontSize: size,
        lineHeight: 1.1,
        whiteSpace: 'nowrap',
        boxShadow: shadow ? pop(shadow) : undefined,
        ...style,
      }}
    >
      {dot && <span style={{ width: size * 0.5, height: size * 0.5, borderRadius: '50%', background: dot, border: `3px solid ${C.ink}`, flexShrink: 0 }} />}
      {children}
    </div>
  );
}

/** Absolutely positioned wrapper with transform helpers. */
export function At({
  x,
  y,
  children,
  scale = 1,
  rotate = 0,
  opacity = 1,
  origin = 'center',
  style,
}: {
  x: number;
  y: number;
  children: ReactNode;
  scale?: number;
  rotate?: number;
  opacity?: number;
  origin?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        transform: `scale(${scale}) rotate(${rotate}deg)`,
        transformOrigin: origin,
        opacity,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

type IconName = 'check' | 'clock' | 'pin' | 'mic' | 'doc' | 'calendar' | 'mail' | 'spark' | 'question' | 'bolt' | 'home' | 'sun' | 'tick';

/** Simple line icons drawn for the film. */
export function Icon({ name, size = 28, color = C.ink, stroke = 2.6 }: { name: IconName; size?: number; color?: string; stroke?: number }) {
  const common = { fill: 'none', stroke: color, strokeWidth: stroke, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const paths: Record<IconName, ReactNode> = {
    check: <path d="M5 12.5l4.5 4.5L19 7.5" {...common} />,
    tick: <path d="M4 12.5l4 4L17 7" {...common} />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" {...common} />
        <path d="M12 7v5l3 2" {...common} />
      </>
    ),
    pin: (
      <>
        <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" {...common} />
        <circle cx="12" cy="9.5" r="2.5" {...common} />
      </>
    ),
    mic: (
      <>
        <rect x="9" y="3" width="6" height="11" rx="3" {...common} />
        <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" {...common} />
      </>
    ),
    doc: (
      <>
        <path d="M7 3h7l4 4v14H7z" {...common} />
        <path d="M14 3v4h4M10 12h5M10 16h5" {...common} />
      </>
    ),
    calendar: (
      <>
        <rect x="4" y="5" width="16" height="15" rx="2.5" {...common} />
        <path d="M4 10h16M9 3v4M15 3v4" {...common} />
      </>
    ),
    mail: (
      <>
        <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" {...common} />
        <path d="M4.5 7l7.5 6 7.5-6" {...common} />
      </>
    ),
    spark: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" {...common} />,
    question: (
      <>
        <path d="M9.2 9.2a2.9 2.9 0 1 1 4.2 2.6c-.9.5-1.4 1.1-1.4 2.2" {...common} />
        <circle cx="12" cy="17.6" r="0.6" fill={color} stroke={color} strokeWidth={stroke * 0.6} />
      </>
    ),
    bolt: <path d="M13 3L6 13h5l-1 8 7-10h-5z" {...common} />,
    home: (
      <>
        <path d="M4 11l8-7 8 7" {...common} />
        <path d="M6.5 9.5V20h11V9.5" {...common} />
      </>
    ),
    sun: (
      <>
        <circle cx="12" cy="12" r="4" {...common} />
        <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" {...common} />
      </>
    ),
  };
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} style={{ display: 'block', flexShrink: 0 }}>
      {paths[name]}
    </svg>
  );
}

/** Voice level bars. `levels` are 0–1. */
export function Waveform({ levels, height, barWidth, gap, color = C.blue }: { levels: number[]; height: number; barWidth: number; gap: number; color?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap, height }}>
      {levels.map((l, i) => (
        <div
          key={i}
          style={{
            width: barWidth,
            height: Math.max(barWidth, l * height),
            borderRadius: barWidth,
            background: color,
            border: `3px solid ${C.ink}`,
          }}
        />
      ))}
    </div>
  );
}

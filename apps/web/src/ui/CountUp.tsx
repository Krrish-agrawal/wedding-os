import { useEffect, useRef } from 'react';
import { animate, useReducedMotion } from 'motion/react';
import { cn } from './cn';

const COUNT_DURATION_S = 0.6;
const COUNT_EASE = [0.2, 0.9, 0.25, 1] as const;

export interface CountUpProps {
  value: number;
  /** Formats every frame, e.g. formatINR. Must be cheap. */
  format?: (n: number) => string;
  /** Seconds. */
  duration?: number;
  className?: string;
}

/**
 * A number that counts to its new value when it changes (an offer applied, a slider moved).
 * First render shows the value as is; reduced-motion users get the new value at once.
 * Writes text directly to the node so a running count never re-renders the tree.
 */
export function CountUp({ value, format = (n) => String(Math.round(n)), duration = COUNT_DURATION_S, className }: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(value);
  const reduce = useReducedMotion();
  const formatRef = useRef(format);
  formatRef.current = format;

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const from = shown.current;
    if (reduce || from === value) {
      shown.current = value;
      node.textContent = formatRef.current(value);
      return;
    }
    const controls = animate(from, value, {
      duration,
      ease: COUNT_EASE,
      onUpdate: (v) => {
        shown.current = v;
        node.textContent = formatRef.current(v);
      },
      onComplete: () => {
        shown.current = value;
        node.textContent = formatRef.current(value);
      },
    });
    return () => controls.stop();
  }, [value, duration, reduce]);

  return (
    <span ref={ref} className={cn('tabular', className)}>
      {format(value)}
    </span>
  );
}

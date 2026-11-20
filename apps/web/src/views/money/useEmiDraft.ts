import { useCallback, useEffect, useRef, useState } from 'react';
import type { EmiInputs, SessionAction } from '@ave/shared';

/** Slider moves are sent to the server at most this often while the buyer drags. */
export const EMI_DISPATCH_DEBOUNCE_MS = 250;

function keyOf(inputs: EmiInputs | null): string {
  return inputs ? `${inputs.downPayment}|${inputs.ratePct}|${inputs.tenureYears}` : 'default';
}

/**
 * EMI inputs for the calculator. Slider moves update the screen at once and reach the server
 * debounced, so a drag does not flood the socket. When the advisor sets new inputs, the sliders
 * follow, unless the buyer is mid-drag, in which case the buyer's value is sent when they stop.
 */
export function useEmiDraft(
  server: EmiInputs | null,
  defaults: EmiInputs,
  dispatch: (action: SessionAction) => void,
): [EmiInputs, (patch: Partial<EmiInputs>) => void] {
  const [draft, setDraft] = useState<EmiInputs | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const effective = draft ?? server ?? defaults;
  const effectiveRef = useRef(effective);
  effectiveRef.current = effective;
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  const serverKey = keyOf(server);
  useEffect(() => {
    if (timer.current === null) setDraft(null);
  }, [serverKey]);

  // A pending send is dropped on unmount: sending it then would pull the stage back to this view.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const update = useCallback((patch: Partial<EmiInputs>) => {
    const next: EmiInputs = { ...effectiveRef.current, ...patch };
    effectiveRef.current = next;
    setDraft(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      dispatchRef.current({ type: 'set_view', view: 'money', params: { emi: next } });
    }, EMI_DISPATCH_DEBOUNCE_MS);
  }, []);

  return [effective, update];
}

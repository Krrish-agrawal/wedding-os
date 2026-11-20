import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Link } from 'react-router';
import { Info, Mic, Phone, PhoneIncoming, PhoneOff, RotateCcw } from 'lucide-react';
import type { SessionAction, SessionState } from '@ave/shared';
import { BRAND_NAME, BrandMark, Button, ICON_STROKE, Kbd, Mascot, buttonClasses } from '@/ui';
import { acceptCall } from './callFlow';
import { ADVISOR_ROLE, firstName, useAdvisorName } from './advisor';
import { usePreloadCallAssets } from './preload';
import { LanguagePicker } from './LanguagePicker';

/** Ring pattern: two quick wiggles, then a pause, like a phone. */
const RING_ROTATE = [0, -7, 7, -6, 6, -3, 0, 0, 0];
const RING_DURATION_S = 1.9;
/** Ink rings that ripple out from the advisor while ringing. */
const RIPPLES = [0, 0.55];
const RIPPLE_DURATION_S = 1.9;

export function Ringing({ state, dispatch }: { state: SessionState; dispatch: (a: SessionAction) => void }) {
  const advisor = useAdvisorName();
  const reduce = useReducedMotion() ?? false;
  const [accepting, setAccepting] = useState(false);
  const once = useRef(false);
  usePreloadCallAssets(true);

  const accept = async () => {
    if (once.current) return;
    once.current = true;
    setAccepting(true);
    await acceptCall(dispatch);
  };
  const decline = () => dispatch({ type: 'set_status', status: 'ended' });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        void accept();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <main className="relative grid h-full grid-rows-[auto_1fr_auto] px-10 py-7">
      <header>
        <BrandMark size="sm" />
      </header>

      <section className="grid place-items-center" aria-labelledby="ringing-title">
        <div className="flex flex-col items-center text-center">
          <div className="relative grid h-[260px] w-[260px] place-items-center">
            {!reduce &&
              RIPPLES.map((delay) => (
                <motion.span
                  key={delay}
                  aria-hidden
                  className="absolute inset-[30px] rounded-full border-2 border-ink"
                  initial={{ scale: 1, opacity: 0 }}
                  animate={{ scale: [1, 1.32], opacity: [0.35, 0] }}
                  transition={{ duration: RIPPLE_DURATION_S, delay, repeat: Infinity, ease: 'easeOut' }}
                />
              ))}
            <div className="relative grid h-[200px] w-[200px] place-items-center rounded-full border-2 border-ink bg-blue-tint shadow-[var(--shadow-pop-lg)]">
              <motion.div
                animate={reduce ? undefined : { rotate: RING_ROTATE }}
                transition={{ duration: RING_DURATION_S, repeat: Infinity, ease: 'easeInOut' }}
                style={{ originY: 0.85 }}
              >
                <Mascot state="wave" size={150} shadow={false} />
              </motion.div>
            </div>
          </div>

          <p className="mt-8 inline-flex items-center gap-2 rounded-[var(--radius-chip)] bg-mint-tint px-3 py-1 text-sm font-bold" role="status">
            <PhoneIncoming size={15} strokeWidth={ICON_STROKE} aria-hidden />
            Incoming call
          </p>
          <h1 id="ringing-title" className="mt-4 text-[56px] font-extrabold leading-[1.02] tracking-[-0.025em]">
            {advisor} is calling
          </h1>
          <p className="mt-2 text-lg text-ink-soft">{ADVISOR_ROLE} · {BRAND_NAME}</p>
          <p className="mt-6 max-w-md text-[17px]">
            Hi {firstName(state.buyer.name)}. Pick up and tell {advisor} what you're looking for. The homes and offices come up on screen as you talk.
          </p>

          <div className="mt-7 flex flex-col items-center gap-2">
            <span className="text-sm font-semibold text-ink-soft">Talk in</span>
            <LanguagePicker language={state.language} dispatch={dispatch} size="lg" />
          </div>

          <div className="mt-7 flex items-center gap-4">
            <Button variant="danger" size="lg" icon={PhoneOff} onClick={decline} disabled={accepting} className="min-w-[160px]">
              Decline
            </Button>
            <Button variant="confirm" size="lg" icon={Phone} onClick={() => void accept()} busy={accepting} className="min-w-[200px]" autoFocus>
              Accept
              <Kbd className="ml-1">Enter</Kbd>
            </Button>
          </div>
        </div>
      </section>

      <footer className="flex items-center justify-center gap-6 text-sm text-ink-soft">
        <span className="inline-flex items-center gap-1.5">
          <Mic size={15} strokeWidth={ICON_STROKE} aria-hidden />
          Your browser will ask for the microphone. You can type instead.
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Info size={15} strokeWidth={ICON_STROKE} aria-hidden />
          Demo with sample listings
        </span>
      </footer>
    </main>
  );
}

/** The buyer declined before the call went live. */
export function Declined({ dispatch }: { dispatch: (a: SessionAction) => void }) {
  const advisor = useAdvisorName();
  return (
    <main className="grid h-full grid-rows-[auto_1fr] px-10 py-7">
      <header>
        <BrandMark size="sm" />
      </header>
      <section className="grid place-items-center text-center">
        <div className="flex max-w-md flex-col items-center">
          <Mascot state="idle" size={140} />
          <h1 className="mt-6 text-4xl font-extrabold">Call declined</h1>
          <p className="mt-2 text-[17px] text-ink-soft">No problem. {advisor} can ring again whenever you're ready.</p>
          <div className="mt-8 flex gap-3">
            <Button variant="primary" size="lg" icon={RotateCcw} onClick={() => dispatch({ type: 'set_status', status: 'ringing' })}>
              Call me now
            </Button>
            <Link to="/" className={buttonClasses('secondary', 'lg')}>
              Back to start
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

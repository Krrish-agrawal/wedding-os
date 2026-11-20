import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowDown, Captions as CaptionsIcon, MicOff, Send, X } from 'lucide-react';
import type { SessionState, TranscriptLine } from '@ave/shared';
import { Button, ICON_STROKE, cn } from '@/ui';
import { useCallControls } from './controls';
import { errorMessage, useCallUi } from './callUi';
import { HUMAN_ADVISOR_FALLBACK_NAME, useAdvisorName } from './advisor';

/** Distance from the bottom (px) within which captions keep following new lines. */
const STICK_THRESHOLD_PX = 32;
const MAX_TYPED_LENGTH = 500;

const ROLE_STYLE: Record<TranscriptLine['role'], string> = {
  buyer: 'text-ink-soft',
  agent: 'text-blue-deep',
  human: 'text-grape-deep',
};

function useSpeakerNames(state: SessionState): Record<TranscriptLine['role'], string> {
  const advisor = useAdvisorName();
  return {
    buyer: 'You',
    agent: advisor,
    human: state.handoff.humanName?.trim() || HUMAN_ADVISOR_FALLBACK_NAME,
  };
}

/**
 * Live captions for both sides. Partial lines are lighter with a dashed rule; final lines are ink.
 * Follows new lines until the buyer scrolls up, then offers a jump back to the latest.
 */
export function Captions({ state }: { state: SessionState }) {
  const names = useSpeakerNames(state);
  const advisor = useAdvisorName();
  const lines = state.transcript;
  const scroller = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(true);
  const stuckRef = useRef(true);
  stuckRef.current = stuck;
  const [unseen, setUnseen] = useState(false);
  const typing = useCallUi((s) => s.typing);

  const lastLine = lines.at(-1);
  const tail = lastLine ? `${lastLine.id}:${lastLine.text.length}:${lines.length}` : '';

  // New or growing lines: follow them, or flag them if the buyer has scrolled up.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (stuckRef.current) el.scrollTop = el.scrollHeight;
    else if (tail) setUnseen(true);
  }, [tail]);

  // The panel resizes when notices or the type box come and go: stay pinned to the latest line.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (stuckRef.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
    setStuck(atBottom);
    if (atBottom) setUnseen(false);
  };

  const jumpToLatest = () => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setStuck(true);
    setUnseen(false);
  };

  return (
    <section aria-label="Captions" className="relative flex min-h-0 flex-1 flex-col rounded-[var(--radius-card)] border-2 border-ink bg-canvas">
      <header className="flex items-center gap-2 border-b-2 border-line px-4 py-2.5">
        <CaptionsIcon size={16} strokeWidth={ICON_STROKE} aria-hidden className="text-blue-deep" />
        <h2 className="font-display text-[15px] font-bold">Captions</h2>
      </header>

      <div
        ref={scroller}
        onScroll={onScroll}
        className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-4 py-3"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
      >
        {lines.length === 0 ? (
          <p className="mx-auto mt-6 max-w-[240px] text-center text-sm text-ink-soft">
            What you and {advisor} say will appear here as you talk.
          </p>
        ) : (
          <ol className="flex flex-col gap-2.5">
            {lines.map((line, i) => {
              const prev = lines[i - 1];
              const showName = !prev || prev.role !== line.role;
              return (
                <li key={line.id} className={cn(!showName && '-mt-1.5')}>
                  {showName && <p className={cn('mb-0.5 text-[11px] font-extrabold uppercase tracking-[0.08em]', ROLE_STYLE[line.role])}>{names[line.role]}</p>}
                  <p
                    className={cn(
                      'text-[14.5px] leading-snug',
                      line.final ? 'text-ink' : 'border-l-2 border-dashed border-ink-mute pl-2 text-ink-soft',
                    )}
                  >
                    {line.text}
                    {!line.final && <span className="sr-only"> (still speaking)</span>}
                  </p>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <AnimatePresence>
        {unseen && !stuck && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.14 }}
            className={cn('pointer-events-none absolute inset-x-0 flex justify-center', typing ? 'bottom-[104px]' : 'bottom-3')}
          >
            <button
              type="button"
              onClick={jumpToLatest}
              className="pointer-events-auto inline-flex items-center gap-1.5 rounded-[var(--radius-chip)] border-2 border-ink bg-canvas px-3 py-1 text-xs font-bold shadow-[var(--shadow-pop-sm)]"
            >
              <ArrowDown size={13} strokeWidth={ICON_STROKE} aria-hidden />
              Latest
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>{typing && <TypeBox advisor={advisor} />}</AnimatePresence>
    </section>
  );
}

/** Type-instead-of-talk. Reaches the same advisor through `sendText`. */
function TypeBox({ advisor }: { advisor: string }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const setTyping = useCallUi((s) => s.setTyping);
  const voiceIssue = useCallUi((s) => s.voiceIssue);
  const voice = useCallControls((s) => s.voice);
  const voiceDetail = useCallControls((s) => s.voiceDetail);
  const voiceDown = voice === 'failed' || voice === 'unavailable' || (Boolean(voiceIssue) && voice !== 'connected');
  const reason = voiceDetail ?? voiceIssue;

  useEffect(() => {
    input.current?.focus();
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true);
    setError(null);
    try {
      await useCallControls.getState().sendText(message);
      setText('');
    } catch (err) {
      setError(`Couldn't send that to ${advisor}. ${errorMessage(err, 'Please try again.')}`);
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  };

  return (
    <motion.form
      onSubmit={submit}
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.16, ease: [0.2, 0.9, 0.25, 1] }}
      className="shrink-0 overflow-hidden border-t-2 border-line"
    >
      {voiceDown && (
        <p className="flex items-center gap-1.5 px-3 pt-2.5 text-[12.5px] font-semibold text-ink-soft" role="status">
          <MicOff size={13} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0" />
          <span className="truncate">{reason ? `${reason.replace(/\.$/, '')}.` : "Voice isn't available."} Type instead.</span>
        </p>
      )}
      <div className="flex items-center gap-2 p-3">
        <label htmlFor="type-to-advisor" className="sr-only">
          Message {advisor}
        </label>
        <input
          id="type-to-advisor"
          ref={input}
          value={text}
          maxLength={MAX_TYPED_LENGTH}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setTyping(false);
          }}
          placeholder={`Type to ${advisor}…`}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'type-to-advisor-error' : undefined}
          className="h-11 min-w-0 flex-1 rounded-[var(--radius-control)] border-2 border-ink/25 px-3 text-[14.5px] outline-none placeholder:text-ink-mute focus:border-ink"
        />
        <Button type="submit" iconOnly icon={Send} label="Send" busy={busy} disabled={!text.trim()} />
        <Button variant="ghost" iconOnly icon={X} label="Close typing" onClick={() => setTyping(false)} />
      </div>
      {error && (
        <p id="type-to-advisor-error" role="alert" className="px-3 pb-3 text-[13px] font-semibold text-coral-deep">
          {error}
        </p>
      )}
    </motion.form>
  );
}

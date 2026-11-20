import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Hand } from 'lucide-react';
import { formatSqft, type Property } from '@ave/shared';
import { Button, ErrorState, ICON_STROKE, LoadingState } from '@/ui';
import type { ModelState } from '@/three/modelStore';
import { TOUR } from './config';

export interface StopCaption {
  key: string;
  label: string;
  /** Area of the stop's room, or of the whole home for the overview. */
  areaSqft: number | null;
  facts: string[];
}

/** Room label and fact chips for the stop the camera has arrived at. */
export function StopCard({ caption, visible }: { caption: StopCaption | null; visible: boolean }) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence mode="wait">
      {caption && visible && (
        <motion.div
          key={caption.key}
          initial={{ opacity: 0, y: reduce ? 0 : -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: reduce ? 0 : -4 }}
          transition={{ duration: TOUR.overlayFadeS, ease: [0.2, 0.9, 0.25, 1] }}
          className="max-w-[min(560px,70%)] rounded-[var(--radius-card)] border-2 border-ink bg-canvas px-4 py-3 shadow-[var(--shadow-pop-sm)]"
          aria-live="polite"
        >
          <div className="flex items-baseline gap-3">
            <h2 className="font-display text-[26px] leading-tight font-bold">{caption.label}</h2>
            {caption.areaSqft !== null && <span className="tabular shrink-0 text-sm font-semibold text-ink-soft">{formatSqft(caption.areaSqft)}</span>}
          </div>
          {caption.facts.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {caption.facts.map((f) => (
                <li key={f} className="rounded-[var(--radius-chip)] border-2 border-ink bg-blue-tint px-3 py-1 text-[13px] leading-5 font-semibold text-ink">
                  {f}
                </li>
              ))}
            </ul>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Small attribution line for the 3D model, as its licence requires. */
export function ModelCredit({ credits }: { credits: Property['credits'] }) {
  if (!credits.length) return null;
  return (
    <p className="pointer-events-auto rounded-[8px] bg-canvas/90 px-2 py-0.5 text-[11px] leading-4 text-ink-soft">
      {credits.map((c, i) => (
        <span key={c.url}>
          {i > 0 && ' · '}
          3D model{' '}
          <a href={c.url} target="_blank" rel="noopener noreferrer" className="underline decoration-line underline-offset-2 hover:text-ink">
            “{c.title}”
          </a>{' '}
          by {c.author}, {c.license.replace(/\s*\(.*\)$/, '')}
        </span>
      ))}
    </p>
  );
}

/** A one-time nudge that the view can be dragged. */
export function DragHint({ visible }: { visible: boolean }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="flex items-center gap-1.5 rounded-[var(--radius-chip)] border-2 border-ink bg-canvas px-3 py-1 text-[13px] font-semibold"
        >
          <Hand size={15} strokeWidth={ICON_STROKE} aria-hidden />
          Drag to look around
        </motion.p>
      )}
    </AnimatePresence>
  );
}

const PERCENT = 100;

/** Loading and error states for the model. Progress is the real download progress. */
export function ModelStatus({ state, onRetry }: { state: ModelState; onRetry: () => void }) {
  if (state.status === 'error') {
    return (
      <div className="absolute inset-0 bg-canvas">
        <ErrorState
          title="The 3D tour did not load"
          body="Everything else on the call still works. Try loading the tour again."
          actions={
            <Button variant="primary" onClick={onRetry}>
              Try again
            </Button>
          }
        />
      </div>
    );
  }
  if (state.status === 'ready') return null;
  const progress = state.status === 'downloading' ? state.progress : state.status === 'preparing' ? 1 : null;
  const pct = progress === null ? null : Math.round(progress * PERCENT);
  return (
    <div className="absolute inset-0 bg-canvas">
      <LoadingState
        title={state.status === 'preparing' ? 'Setting up the rooms' : 'Loading the 3D tour'}
        body={
          <div className="mx-auto mt-1 w-64">
            <div
              role="progressbar"
              aria-label="3D tour download"
              aria-valuemin={0}
              aria-valuemax={PERCENT}
              aria-valuenow={pct ?? undefined}
              className="h-3 overflow-hidden rounded-[var(--radius-chip)] border-2 border-ink bg-blue-tint"
            >
              <div className="h-full bg-blue transition-[width] duration-200 ease-out" style={{ width: `${pct ?? 0}%` }} />
            </div>
            <p className="tabular mt-2 text-sm text-ink-soft">{pct === null ? 'Starting' : `${pct}%`}</p>
          </div>
        }
      />
    </div>
  );
}

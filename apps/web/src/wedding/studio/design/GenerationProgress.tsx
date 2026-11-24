import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, CircleAlert, RotateCcw, X } from 'lucide-react';
import { Button, Card, Notice, Spinner } from '@/ui';
import { useWedding } from '../../useWedding';
import { designApi, type DesignJob } from './designApi';
import { TERMINAL, errorMessage, stageLabel } from './helpers';

const STAGES = ['analysing', 'planning', 'rendering'] as const;

/**
 * Starts a generation job (`start`) and follows it by polling once a second until it ends. The scene only changes at the
 * very end, so on any failure or cancel the previous design is exactly as it was.
 */
export default function GenerationProgress({ start, hadPrevious, onDone, onBack }: { start: () => Promise<{ job: DesignJob }>; hadPrevious: boolean; onDone: () => void; onBack: () => void }) {
  const { id, load } = useWedding();
  const [job, setJob] = useState<DesignJob | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const alive = useRef(true);
  const startRef = useRef(start);
  startRef.current = start;

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    setJob(null);
    setStartError(null);
    (async () => {
      let current: DesignJob;
      try { current = (await startRef.current()).job; } catch (e) { if (!stopped) setStartError((e as Error).message); return; }
      const tick = async (j: DesignJob): Promise<void> => {
        if (stopped) return;
        setJob(j);
        if (TERMINAL.includes(j.status)) {
          if (j.status === 'completed') { await load(); if (!stopped) onDone(); }
          return;
        }
        timer = setTimeout(async () => {
          try { await tick((await designApi.job(id, j.id)).job); } catch (e) { if (!stopped) setStartError(`Lost contact with the server: ${(e as Error).message}`); }
        }, 1000);
      };
      await tick(current);
    })();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, id]);

  const cancel = useCallback(async () => { if (job) { try { setJob((await designApi.cancel(id, job.id)).job); } catch (e) { setStartError((e as Error).message); } } }, [id, job]);

  const source = job?.source ?? 'demo';
  const failed = job?.status === 'failed' || job?.status === 'cancelled';
  const idx = job ? STAGES.indexOf(job.status as (typeof STAGES)[number]) : -1;

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <Card className="flex flex-col gap-4 p-6" aria-live="polite">
        <h1 className="font-display text-3xl font-extrabold">{startError ? 'Could not start' : job ? stageLabel(job.status, source) : 'Starting…'}</h1>
        {startError ? (
          <>
            <Notice tone="error" title="The design could not run" body={startError} live="assertive" />
            <div className="flex gap-2"><Button icon={RotateCcw} onClick={() => setAttempt((a) => a + 1)}>Try again</Button><Button variant="secondary" onClick={onBack}>Back</Button></div>
          </>
        ) : (
          <>
            {!failed && job?.status !== 'completed' ? (
              <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((job?.progress ?? 0) * 100)} className="h-3 overflow-hidden rounded-full border-2 border-ink bg-paper">
                <div className="h-full bg-blue transition-all" style={{ width: `${Math.max(5, Math.round((job?.progress ?? 0) * 100))}%` }} />
              </div>
            ) : null}
            <ol className="flex flex-col gap-2 text-[15px]">
              {STAGES.map((s, i) => {
                const done = job?.status === 'completed' || (idx > i);
                const active = idx === i;
                return (
                  <li key={s} className="flex items-center gap-2">
                    {done ? <Check size={16} className="text-mint-deep" aria-label="done" /> : active ? <Spinner size={16} /> : <span className="h-4 w-4 rounded-full border-2 border-line" aria-hidden />}
                    <span className={active ? 'font-semibold' : done ? 'text-ink-soft' : 'text-ink-soft/70'}>{stageLabel(s, source)}</span>
                  </li>
                );
              })}
            </ol>
            {failed ? (
              <>
                <Notice tone={job?.status === 'cancelled' ? 'info' : 'error'} icon={CircleAlert} title={job?.status === 'cancelled' ? 'Cancelled' : 'The design was not created'} body={`${errorMessage(job?.error?.code, job?.error?.message)}${hadPrevious ? ' Your previous design is unchanged.' : ''}`} live="assertive" />
                <div className="flex gap-2"><Button icon={RotateCcw} onClick={() => setAttempt((a) => a + 1)}>Try again</Button><Button variant="secondary" onClick={onBack}>{hadPrevious ? 'Back to my design' : 'Back'}</Button></div>
              </>
            ) : job && !TERMINAL.includes(job.status) ? (
              <div className="flex items-center justify-between gap-3">
                {hadPrevious ? <p className="text-sm text-ink-soft">Your previous design stays as it is until the new one is ready.</p> : <span />}
                <Button variant="ghost" icon={X} onClick={() => void cancel()}>Cancel</Button>
              </div>
            ) : null}
          </>
        )}
      </Card>
    </div>
  );
}

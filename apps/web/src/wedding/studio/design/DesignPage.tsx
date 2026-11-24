import { useState } from 'react';
import type { DesignForm } from '@ave/shared';
import { useWedding } from '../../useWedding';
import DesignResult from './DesignResult';
import DesignStart from './DesignStart';
import GenerationProgress from './GenerationProgress';
import { designApi, type DesignJob } from './designApi';

type Phase = { name: 'start' } | { name: 'progress'; start: () => Promise<{ job: DesignJob }> } | { name: 'result' };

/** The default Studio: create (form) -> generation progress -> result. Advanced Edit lives at /studio/edit. */
export default function DesignPage() {
  const { id, state } = useWedding();
  const [phase, setPhase] = useState<Phase | null>(null);
  if (!state) return <p className="text-ink-soft">Loading…</p>;
  const hasDesign = state.design.versions.length > 0 && state.scene.objects.length > 0;
  const current: Phase = phase ?? (hasDesign ? { name: 'result' } : { name: 'start' });

  const begin = (job: { form: DesignForm; venueId: string; imageIds: string[] }) => setPhase({ name: 'progress', start: () => designApi.generate(id, job) });

  if (current.name === 'progress') return <GenerationProgress key={String(current.start)} start={current.start} hadPrevious={hasDesign} onDone={() => setPhase({ name: 'result' })} onBack={() => setPhase(hasDesign ? { name: 'result' } : { name: 'start' })} />;
  if (current.name === 'result') return <DesignResult onAnother={() => setPhase({ name: 'progress', start: () => designApi.another(id) })} onNew={() => setPhase({ name: 'start' })} />;
  return <DesignStart onStart={begin} />;
}

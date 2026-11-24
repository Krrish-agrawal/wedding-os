import { Button } from '@/ui';
import { creditsFor } from './glb';
import { useStudio } from './useStudio';

/** High/Fast switch: Fast turns off shadows, bloom, HDRI lighting and textures for weak GPUs and phones. */
export function QualityToggle() {
  const quality = useStudio((s) => s.quality);
  const setQuality = useStudio((s) => s.setQuality);
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="Rendering quality">
      <span className="text-[13px] font-semibold text-ink-soft">Quality</span>
      <Button size="sm" variant={quality === 'high' ? 'primary' : 'ghost'} aria-pressed={quality === 'high'} onClick={() => setQuality('high')}>High</Button>
      <Button size="sm" variant={quality === 'fast' ? 'primary' : 'ghost'} aria-pressed={quality === 'fast'} onClick={() => setQuality('fast')}>Fast</Button>
    </div>
  );
}

/** Courtesy credits for third-party 3D assets (shown even where the licence, CC0, does not require it). */
export function CreditsNote() {
  const lines = creditsFor();
  if (lines.length === 0) return null;
  return <p className="text-[12px] text-ink-soft">{lines.join(' ')} <a className="underline" href="https://polyhaven.com/license" target="_blank" rel="noreferrer">Licence</a></p>;
}

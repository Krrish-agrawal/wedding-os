import type { ReactNode, RefObject } from 'react';
import { MapPinOff, Satellite } from 'lucide-react';
import { Notice, Pill, Spinner } from '@/ui';
import { useMapStatus, type MapHandle } from './engine';
import { TILE_TIERS } from './tiles';

interface MapFrameProps {
  hostRef: RefObject<HTMLDivElement | null>;
  handle: MapHandle | null;
  /** What the buyer can still use when the map cannot draw, e.g. "The places are listed on the right." */
  fallbackHint: string;
  /** Overlays drawn on top of the map (not markers; those live inside the map). */
  children?: ReactNode;
}

const MAPTILER_LOGO_URL = 'https://api.maptiler.com/resources/logo.svg';
const MAPTILER_HOME = 'https://www.maptiler.com';
/** Whether this build was configured for satellite imagery, so a street map is a fallback worth naming. */
const SATELLITE_FIRST = TILE_TIERS[0]?.satellite ?? false;

/**
 * The area a view lends to the shared map, with every map state designed:
 * loading the library, no WebGL, satellite unavailable, and no tiles at all.
 */
export function MapFrame({ hostRef, handle, fallbackHint, children }: MapFrameProps) {
  const phase = useMapStatus((s) => s.phase);
  const tier = useMapStatus((s) => s.tier);
  const degraded = useMapStatus((s) => s.degraded);
  const tilesUnavailable = useMapStatus((s) => s.tilesUnavailable);

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-paper">
      <div ref={hostRef} className="absolute inset-0" />

      {!handle && phase !== 'failed' && (
        <div className="absolute inset-0 grid place-items-center">
          <span className="inline-flex items-center gap-2 rounded-[var(--radius-chip)] border-2 border-ink bg-canvas px-3 py-1.5 text-sm font-semibold">
            <Spinner size={16} />
            Loading the map
          </span>
        </div>
      )}

      {phase === 'failed' && (
        <div className="absolute inset-0 grid place-items-center p-8">
          <Notice tone="warn" icon={MapPinOff} title="This browser can't draw the map" body={fallbackHint} live="polite" className="max-w-sm" />
        </div>
      )}

      {handle && tilesUnavailable && (
        <div className="pointer-events-none absolute bottom-10 left-3 max-w-sm">
          <Notice tone="warn" icon={MapPinOff} title="Map imagery isn't loading right now" body={`Pins and routes are still accurate. ${fallbackHint}`} />
        </div>
      )}

      {handle && degraded && !tilesUnavailable && tier && SATELLITE_FIRST && !tier.satellite && (
        <div className="pointer-events-none absolute left-3 top-3">
          <Pill tone="muted" icon={Satellite} size="sm">
            Satellite unavailable · {tier.label.toLowerCase()}
          </Pill>
        </div>
      )}

      {handle && tier?.requiresMapTilerLogo && (
        <a href={MAPTILER_HOME} target="_blank" rel="noopener" className="absolute bottom-2 left-2 z-10 block" aria-label="MapTiler">
          <img src={MAPTILER_LOGO_URL} alt="MapTiler logo" className="h-6 w-auto" />
        </a>
      )}

      {children}
    </div>
  );
}

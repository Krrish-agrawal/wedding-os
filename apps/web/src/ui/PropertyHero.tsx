import { useId, useState } from 'react';
import { Compass, Layers } from 'lucide-react';
import { formatFloor, type Direction, type Property } from '@ave/shared';
import { cn } from './cn';
import { ICON_STROKE } from './icons';
import { propertyTypeIcon } from './propertyIcon';

/** Remembers images that failed so a missing render is requested once per page load, not per mount. */
const imageStatus = new Map<string, 'loaded' | 'failed'>();

const DIRECTION_NAMES: Record<Direction, string> = {
  N: 'North',
  NE: 'North-east',
  E: 'East',
  SE: 'South-east',
  S: 'South',
  SW: 'South-west',
  W: 'West',
  NW: 'North-west',
};

/**
 * The property's hero render. Until a render exists (or if it fails to load) a designed
 * plate shows instead: blueprint grid, the property type, and two real facts from the data.
 * Never a broken image.
 */
export function PropertyHero({ property, className, compact = false }: { property: Property; className?: string; compact?: boolean }) {
  const src = property.heroImage;
  const [status, setStatus] = useState<'loading' | 'loaded' | 'failed'>(() => imageStatus.get(src) ?? 'loading');
  const patternId = useId();
  const Icon = propertyTypeIcon(property);

  return (
    <div className={cn('relative isolate overflow-hidden bg-blue-tint', className)}>
      {status !== 'loaded' && (
        <div className="absolute inset-0 grid place-items-center" aria-hidden>
          <svg className="absolute inset-0 h-full w-full text-blue" aria-hidden>
            <defs>
              <pattern id={patternId} width="28" height="28" patternUnits="userSpaceOnUse">
                <path d="M28 0H0V28" fill="none" stroke="currentColor" strokeOpacity="0.22" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill={`url(#${patternId})`} />
          </svg>
          <span
            className={cn(
              'relative grid place-items-center rounded-full border-2 border-ink bg-canvas text-ink shadow-[var(--shadow-pop)]',
              compact ? 'h-16 w-16' : 'h-24 w-24',
            )}
          >
            <Icon size={compact ? 28 : 40} strokeWidth={ICON_STROKE} />
          </span>
          {!compact && (
            <span className="absolute bottom-4 left-4 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-[10px] border-2 border-ink bg-canvas px-2.5 py-1 text-xs font-bold">
                <Layers size={13} strokeWidth={ICON_STROKE} />
                {formatFloor(property.floor)}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-[10px] border-2 border-ink bg-canvas px-2.5 py-1 text-xs font-bold">
                <Compass size={13} strokeWidth={ICON_STROKE} />
                {DIRECTION_NAMES[property.entranceFacing]}-facing entrance
              </span>
            </span>
          )}
        </div>
      )}
      {status !== 'failed' && (
        <img
          src={src}
          alt={`${property.name}, ${property.localityName}`}
          decoding="async"
          onLoad={() => {
            imageStatus.set(src, 'loaded');
            setStatus('loaded');
          }}
          onError={() => {
            imageStatus.set(src, 'failed');
            setStatus('failed');
          }}
          className={cn('absolute inset-0 h-full w-full object-cover transition-opacity duration-300', status === 'loaded' ? 'opacity-100' : 'opacity-0')}
        />
      )}
    </div>
  );
}

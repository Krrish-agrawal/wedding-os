import { useEffect, useMemo, useState } from 'react';
import { roomLevelOf, type PropertyBundle } from '@ave/shared';
import { propertyLevels, type Level } from '@/three/levels';
import { ACCENT_BG } from '@/ui/accent';
import { cn } from '@/ui/cn';
import { preloadPlanImages } from './hooks';
import type { Accent } from '@/views/types';

/**
 * The level a plan view shows. It follows the room in focus, so when the advisor names a room on
 * the mezzanine the plan turns to the mezzanine; the buyer can also pick a level by hand.
 */
export function usePlanLevel(bundle: PropertyBundle, followRoomId: string | null): { level: number; setLevel: (n: number) => void; levels: Level[] } {
  const levels = useMemo(() => propertyLevels(bundle.property), [bundle.property]);
  const followLevel = useMemo(() => {
    const room = followRoomId ? bundle.rooms.find((r) => r.id === followRoomId) : undefined;
    return room ? roomLevelOf(room) : null;
  }, [bundle.rooms, followRoomId]);
  const [level, setLevel] = useState(() => followLevel ?? levels[0]!.index);
  useEffect(() => {
    if (followLevel !== null) setLevel(followLevel);
  }, [followLevel]);
  return { level, setLevel, levels };
}

/** A segmented control for multi-level properties; renders nothing for a single level. */
export function LevelSwitch({ levels, level, onLevel, accent }: { levels: Level[]; level: number; onLevel: (n: number) => void; accent: Accent }) {
  if (levels.length < 2) return null;
  return (
    <div role="group" aria-label="Level" className="inline-flex rounded-[12px] border-2 border-ink bg-canvas p-0.5 shadow-[var(--shadow-pop-sm)]">
      {levels.map((l) => (
        <button
          key={l.index}
          type="button"
          aria-pressed={l.index === level}
          onClick={() => onLevel(l.index)}
          className={cn('rounded-[9px] px-3 py-1 text-[13px] font-bold transition-colors duration-100', l.index === level ? cn(ACCENT_BG[accent], 'text-ink') : 'text-ink-soft hover:text-ink')}
        >
          {l.name}
        </button>
      ))}
    </div>
  );
}

/** Warms the browser cache with every plan image of every property (call while the call rings). */
export function preloadAllPlanImages(bundles: PropertyBundle[]): void {
  preloadPlanImages(bundles.flatMap((b) => propertyLevels(b.property).map((l) => l.planImage)));
}

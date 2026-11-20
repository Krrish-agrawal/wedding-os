import { useEffect, useState, type ReactNode } from 'react';
import { Laptop } from 'lucide-react';
import { BrandMark, ICON_STROKE, Mascot } from '@/ui';

const MIN_WIDTH = 1100;

/** The product is desktop-only. Narrow windows get a polite note instead of a broken layout. */
export function DesktopOnly({ children }: { children: ReactNode }) {
  const [wide, setWide] = useState(() => window.innerWidth >= MIN_WIDTH);
  useEffect(() => {
    const onResize = () => setWide(window.innerWidth >= MIN_WIDTH);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  if (wide) return <>{children}</>;
  return (
    <main className="flex min-h-full flex-col items-center justify-center gap-8 p-6 text-center">
      <BrandMark size="sm" />
      <div className="flex max-w-sm flex-col items-center rounded-[24px] border-2 border-ink bg-canvas p-7 shadow-[var(--shadow-pop)]">
        <Mascot state="idle" size={112} />
        <h1 className="mt-5 text-[28px] font-extrabold leading-tight">Open this on a laptop</h1>
        <p className="mt-2 text-ink-soft">
          The call puts the home, the map and the numbers on screen while you talk, so it needs a wider window than this one.
        </p>
        <p className="mt-5 inline-flex items-center gap-2 rounded-[var(--radius-chip)] bg-blue-tint px-3 py-1.5 text-sm font-semibold">
          <Laptop size={16} strokeWidth={ICON_STROKE} aria-hidden />
          Widen this window, or switch to a laptop
        </p>
      </div>
    </main>
  );
}

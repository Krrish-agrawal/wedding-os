import { cn } from '../cn';
import { Mascot } from './Mascot';

const SIZES = {
  sm: { glyph: 30, text: 'text-[17px]' },
  md: { glyph: 40, text: 'text-xl' },
  lg: { glyph: 56, text: 'text-[28px]' },
} as const;

/** The mascot glyph with the wordmark. Swaps to the owner's logo when it arrives (see assets/brand). */
export function BrandMark({ size = 'md', className }: { size?: keyof typeof SIZES; className?: string }) {
  const s = SIZES[size];
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <Mascot size={s.glyph} shadow={false} />
      <span className={cn('font-display leading-none tracking-[-0.02em] text-ink', s.text)}>
        <span className="font-extrabold">Agora</span> <span className="font-semibold">Virtual Estates</span>
      </span>
    </span>
  );
}

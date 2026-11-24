import { BadgeCheck, CircleHelp, FlaskConical, ShieldQuestion } from 'lucide-react';
import { Pill, cn } from '@/ui';
import type { VendorView } from './api';

/** Gradient artwork for `art:<key>` images. Demo vendors have no photographs; this is drawn by the app. */
const ART: Record<string, string> = {
  gold: 'linear-gradient(135deg,#f6d27a,#c98a1b)', rose: 'linear-gradient(135deg,#f8c3d0,#d4547a)', ruby: 'linear-gradient(135deg,#e8798c,#8d1a3a)', ivory: 'linear-gradient(135deg,#fbf6ea,#d9cbb0)',
  leaf: 'linear-gradient(135deg,#bfe3b4,#4b8f5a)', saffron: 'linear-gradient(135deg,#ffc66b,#e06a1b)', ink: 'linear-gradient(135deg,#6b7280,#1f2937)', indigo: 'linear-gradient(135deg,#9aa5f0,#3b3f9e)',
};

export function Art({ src, className, label }: { src: string | null | undefined; className?: string; label?: string }) {
  const key = src?.startsWith('art:') ? src.slice(4) : null;
  if (!key && src) return <img src={src} alt={label ?? ''} loading="lazy" className={cn('object-cover', className)} />;
  return <div role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} className={cn(className)} style={{ background: ART[key ?? 'ivory'] ?? ART.ivory }} />;
}

/** The single place that decides how a vendor's trust level is shown: demo data, unverified and verified look different. */
export function TrustBadge({ vendor, size = 'sm' }: { vendor: Pick<VendorView, 'trust'>; size?: 'sm' | 'md' }) {
  const t = vendor.trust;
  if (t === 'DEMO DATA') return <Pill tone="warn" icon={FlaskConical} size={size}>DEMO DATA</Pill>;
  if (t === 'Verified') return <Pill tone="live" icon={BadgeCheck} size={size}>Verified</Pill>;
  if (t === 'Verification pending') return <Pill tone="waiting" icon={ShieldQuestion} size={size}>Verification pending</Pill>;
  return <Pill tone="muted" icon={CircleHelp} size={size}>Unverified</Pill>;
}

export const CATEGORY_LABELS: Record<string, string> = {
  decorator: 'Decorator', caterer: 'Caterer', photographer: 'Photographer', videographer: 'Videographer', makeup: 'Makeup artist', florist: 'Florist', planner: 'Wedding planner', entertainer: 'DJ / entertainer', venue: 'Venue',
};

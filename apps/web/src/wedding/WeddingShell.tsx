import { useEffect } from 'react';
import { NavLink, Outlet } from 'react-router';
import { Bot, Boxes, Flag, Heart, LayoutDashboard, Shirt, Store, Wallet, type LucideIcon } from 'lucide-react';
import { BRAND_NAME, ICON_STROKE, Notice, Pill, cn } from '@/ui';
import { useWedding } from './useWedding';

export const NAV: { to: string; label: string; icon: LucideIcon; end?: boolean; flag?: string }[] = [
  { to: '/', label: 'Wedding Dashboard', icon: LayoutDashboard, end: true },
  { to: '/planner', label: 'AI Wedding Planner', icon: Bot },
  { to: '/studio', label: '3D Wedding Studio', icon: Boxes, flag: 'studio.enabled' },
  { to: '/budget', label: 'Budget Planner', icon: Wallet },
  { to: '/vendors', label: 'Vendor Marketplace', icon: Store, flag: 'vendor.marketplace.enabled' },
  { to: '/tryon', label: 'Virtual Outfit Try-On', icon: Shirt, flag: 'tryon.enabled' },
];

/** The Wedding OS frame: navigation plus whichever page is open. Loads the shared wedding state once. */
export default function WeddingShell() {
  const { load, state, error, meta, flags, loadFlags } = useWedding();
  useEffect(() => {
    void load();
    void loadFlags();
    const t = setInterval(() => void loadFlags(), 10_000);
    return () => clearInterval(t);
  }, [load, loadFlags]);

  return (
    <div className="flex min-h-full flex-col bg-paper md:flex-row">
      <aside className="border-b-2 border-ink bg-canvas md:sticky md:top-0 md:h-screen md:w-64 md:shrink-0 md:border-b-0 md:border-r-2">
        <div className="flex items-center gap-2.5 px-5 py-4">
          <span aria-hidden className="grid h-10 w-10 place-items-center rounded-[12px] border-2 border-ink bg-blue text-canvas shadow-[var(--shadow-pop-sm)]">
            <Heart size={20} strokeWidth={ICON_STROKE} fill="currentColor" />
          </span>
          <span className="font-display text-xl font-extrabold leading-none">{BRAND_NAME}</span>
        </div>
        <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible md:pb-0">
          {[...NAV, { to: '/flags', label: 'Feature flags', icon: Flag } as (typeof NAV)[number]].filter((n) => !n.flag || flags?.flags[n.flag] !== false).map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex shrink-0 items-center gap-2.5 rounded-[var(--radius-control)] border-2 px-3 py-2.5 text-sm font-semibold transition-colors',
                  isActive ? 'border-ink bg-blue-tint text-ink shadow-[var(--shadow-pop-sm)]' : 'border-transparent text-ink-soft hover:bg-paper hover:text-ink',
                )
              }
            >
              <Icon size={18} strokeWidth={ICON_STROKE} aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="hidden px-5 py-4 md:block">
          <Pill tone={meta?.plannerMode === 'llm' ? 'live' : 'waiting'} dot size="sm">
            {meta ? (meta.plannerMode === 'llm' ? `AI: ${meta.model}` : 'Demo mode (no AI key)') : 'Connecting…'}
          </Pill>
        </div>
      </aside>

      <main className="min-w-0 flex-1 p-5 md:p-8">
        {error && !state ? (
          <Notice tone="error" icon={Heart} title="Can't reach the Wedding OS server" body={`${error} Start it with "pnpm dev".`} live="assertive" />
        ) : (
          <Outlet />
        )}
      </main>
    </div>
  );
}

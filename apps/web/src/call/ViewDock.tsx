import { VIEW_LABELS, type SessionAction, type SessionState, type ViewId } from '@ave/shared';
import { VIEW_ORDER, VIEWS } from '@/views/registry';
import { otherPropertyId } from '@/content';
import { ACCENT_BG, ACCENT_ICON, ICON_STROKE, cn } from '@/ui';

interface ViewDockProps {
  state: SessionState;
  dispatch: (action: SessionAction) => void;
}

/**
 * One tile per view, colour-coded by the view's accent, so the dock reads as a map of the product.
 * Clicking switches the view for everyone on the call (and the advisor hears about it).
 */
export function ViewDock({ state, dispatch }: ViewDockProps) {
  const go = (view: ViewId) => {
    if (VIEWS[view].needsProperty && !state.propertyId) {
      const first = otherPropertyId(null);
      if (first) dispatch({ type: 'set_property', propertyId: first });
    }
    dispatch({ type: 'set_view', view });
  };

  return (
    <nav aria-label="Views" className="grid shrink-0 gap-1.5" style={{ gridTemplateColumns: `repeat(${VIEW_ORDER.length}, minmax(0, 1fr))` }}>
      {VIEW_ORDER.map((id) => {
        const mod = VIEWS[id];
        const Icon = mod.icon;
        const on = state.view === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => go(id)}
            aria-pressed={on}
            aria-current={on ? 'page' : undefined}
            className={cn(
              'group flex h-[58px] min-w-0 flex-col items-center justify-center gap-1 rounded-[14px] border-2 px-1 text-[12.5px] font-bold',
              'transition-[transform,box-shadow,border-color,background-color] duration-100 ease-[var(--ease-snap)] active:translate-y-px',
              on
                ? cn('-translate-y-0.5 border-ink text-ink shadow-[var(--shadow-pop-sm)]', ACCENT_BG[mod.accent])
                : 'border-line bg-canvas text-ink hover:-translate-y-px hover:border-ink',
            )}
          >
            <Icon size={18} strokeWidth={ICON_STROKE} aria-hidden className={on ? 'text-ink' : ACCENT_ICON[mod.accent]} />
            <span className="max-w-full truncate leading-none">{VIEW_LABELS[id]}</span>
          </button>
        );
      })}
    </nav>
  );
}

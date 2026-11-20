import { useEffect } from 'react';
import { PROPERTY_TOGGLE_HOTKEY, VIEW_HOTKEYS, type SessionAction, type SessionState } from '@ave/shared';
import { otherPropertyId } from '@/content';

/**
 * Silent presenter controls: digit keys switch views, 0 switches property.
 * They go through the same reducer as everything else. Ignored while typing.
 */
export function usePresenterKeys(state: SessionState | null, dispatch: (a: SessionAction) => void) {
  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      if (e.key === PROPERTY_TOGGLE_HOTKEY) {
        const next = otherPropertyId(state.propertyId);
        if (next) dispatch({ type: 'set_property', propertyId: next });
        return;
      }
      const view = VIEW_HOTKEYS[e.key];
      if (!view) return;
      if (view !== 'shortlist' && !state.propertyId) {
        const first = otherPropertyId(null);
        if (first) dispatch({ type: 'set_property', propertyId: first });
      }
      dispatch({ type: 'set_view', view });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, dispatch]);
}

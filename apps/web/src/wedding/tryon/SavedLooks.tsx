import { useEffect } from 'react';
import { Link } from 'react-router';
import { Shirt, Trash2 } from 'lucide-react';
import { findGarment } from '@ave/shared';
import { Button, Card, ICON_STROKE, Pill } from '@/ui';
import { garmentThumb } from '@/tryon/garmentArt';
import { useWedding } from '../useWedding';
import { getThumb, pruneThumbs, removeThumb } from './thumbs';

/** The customer's saved looks, for the dashboard. Mount anywhere inside the wedding shell. */
export function SavedLooks() {
  const { state, act } = useWedding();
  const looks = state?.outfits ?? [];
  useEffect(() => { if (state) pruneThumbs(state.outfits.map((o) => o.id)); }, [state]);

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-xl font-extrabold"><Shirt size={20} strokeWidth={ICON_STROKE} aria-hidden />Saved looks</h2>
        <Link to="/tryon" className="text-sm font-semibold underline">Open Virtual Try-On</Link>
      </div>
      {looks.length === 0 ? (
        <p className="text-sm text-ink-soft">No saved looks yet. Try an outfit and press “Save look”.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {looks.map((o) => {
            const g = findGarment(o.garmentId);
            const thumb = getThumb(o.id);
            return (
              <li key={o.id} className="flex items-center gap-3 rounded-[var(--radius-control)] border-2 border-line p-2">
                <img src={thumb ?? (g ? garmentThumb(g) : '')} alt={thumb ? `Your saved preview of ${o.label}` : `Illustration of ${o.label}`} className="h-20 w-14 rounded object-contain bg-paper" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{o.label}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Pill tone="muted" size="sm">{thumb ? 'Preview saved on this device' : 'Illustration'}</Pill>
                    {g?.status === 'experimental' ? <Pill tone="warn" size="sm">Experimental</Pill> : null}
                  </div>
                </div>
                <Button variant="ghost" size="sm" iconOnly icon={Trash2} label={`Delete look ${o.label}`} onClick={() => { removeThumb(o.id); void act({ type: 'remove_outfit', outfitId: o.id }); }} />
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export default SavedLooks;

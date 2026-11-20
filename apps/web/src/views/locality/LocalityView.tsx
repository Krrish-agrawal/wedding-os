import { useEffect, useMemo, useRef } from 'react';
import { Info } from 'lucide-react';
import {
  PLACE_CATEGORIES,
  PLACE_CATEGORY_LABELS,
  formatKm,
  haversineKm,
  type Place,
  type PlaceCategory,
  type PropertyBundle,
  type SessionAction,
} from '@ave/shared';
import { Chip, propertyTypeIcon } from '@/ui';
import type { ViewProps } from '../types';
import { MapFrame } from '../maps/MapFrame';
import { MapMarker } from '../maps/MapMarker';
import { PlacePin, PropertyPin } from '../maps/pins';
import { MAP_PADDING, fitPoints, flyInTo } from '../maps/camera';
import { measureText } from '../maps/labels';
import { useMapHost } from '../maps/useMapHost';
import { LABEL_FONT, useVisibleLabels, type LabelItem } from '../maps/useVisibleLabels';
import { startMapPreloading } from '../maps/preload';
import { placeIcon } from './placeIcon';
import { LocalityPanel } from './LocalityPanel';

startMapPreloading();

/** A selected place is framed with the property, no closer than this, so its neighbours stay in view. */
const SELECTED_MAX_ZOOM = 15.6;
/** Pin, gap, tag padding and a margin around the selected place's name tag. */
const SELECTED_TAG_ROOM_PX = 72;

export interface PlaceWithDistance extends Place {
  km: number;
}

/** Locality view: the neighbourhood map, nearby places by category, and the area profile. */
export default function LocalityView({ state, bundle, dispatch }: ViewProps) {
  if (!bundle) return null;
  return <Locality bundle={bundle} category={state.params.locality.category} placeId={state.params.locality.placeId} dispatch={dispatch} />;
}

interface LocalityProps {
  bundle: PropertyBundle;
  category: PlaceCategory | null;
  placeId: string | null;
  dispatch: (action: SessionAction) => void;
}

function Locality({ bundle, category, placeId, dispatch }: LocalityProps) {
  const { property, locality } = bundle;
  const origin = property.location;
  const { hostRef, handle } = useMapHost(origin);

  const places = useMemo<PlaceWithDistance[]>(
    () => locality.places.map((p) => ({ ...p, km: haversineKm(origin, p) })).sort((a, b) => a.km - b.km),
    [locality, origin],
  );
  const inCategory = useMemo(() => (category ? places.filter((p) => p.category === category) : []), [places, category]);
  const selected = placeId ? (places.find((p) => p.id === placeId) ?? null) : null;
  const pinned = useMemo(
    () => (selected && !inCategory.includes(selected) ? [...inCategory, selected] : inCategory),
    [inCategory, selected],
  );

  const show = (patch: { category?: PlaceCategory | null; placeId?: string | null }) =>
    dispatch({ type: 'set_view', view: 'locality', params: patch });
  const selectPlace = (p: PlaceWithDistance) =>
    show(p.id === placeId ? { placeId: null } : { category: p.category, placeId: p.id });

  // Camera: fly in on arrival, frame the pins for a category, frame home and place for a selection.
  const arrivedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!handle) return;
    const { map } = handle;
    const home: [number, number] = [origin.lng, origin.lat];
    const arriving = arrivedFor.current !== property.id;
    arrivedFor.current = property.id;
    if (selected) {
      // Leave room on the right for the selected place's name tag.
      const tag = measureText(`${selected.name}  ${formatKm(selected.km)}`, LABEL_FONT) + SELECTED_TAG_ROOM_PX;
      const padding = { ...MAP_PADDING, right: Math.max(MAP_PADDING.right, tag) };
      fitPoints(map, [home, [selected.lng, selected.lat]], { maxZoom: SELECTED_MAX_ZOOM, padding });
    }
    else if (pinned.length) fitPoints(map, [home, ...pinned.map((p): [number, number] => [p.lng, p.lat])]);
    else flyInTo(map, origin, { fromAfar: arriving });
    // Re-frame only when what is shown changes (property, category, selection), not on every render.
  }, [handle, property.id, category, selected?.id]);

  const labelItems = useMemo<LabelItem[]>(
    () => pinned.map((p) => ({ id: p.id, lat: p.lat, lng: p.lng, text: `${p.name}  ${formatKm(p.km)}`, priority: p.id === selected?.id ? -1 : p.km })),
    [pinned, selected?.id],
  );
  const labelled = useVisibleLabels(handle, labelItems, { ...origin, label: property.name });

  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_minmax(300px,31%)]">
      <section className="flex min-h-0 flex-col" aria-label={`Map of ${locality.name}`}>
        <div role="toolbar" aria-label="Nearby places" className="flex flex-wrap items-center gap-1.5 border-b-2 border-ink bg-canvas px-3 py-2.5">
          <Chip size="sm" accent="tangerine" icon={Info} label="Overview" selected={category === null} onClick={() => show({ category: null, placeId: null })} />
          {PLACE_CATEGORIES.map((c) => (
            <Chip
              key={c}
              size="sm"
              accent="tangerine"
              icon={placeIcon({ category: c })}
              label={PLACE_CATEGORY_LABELS[c]}
              selected={category === c}
              onClick={() => show({ category: c, placeId: null })}
            />
          ))}
        </div>
        <MapFrame hostRef={hostRef} handle={handle} fallbackHint="The places and area notes are listed alongside.">
          {handle && (
            <>
              <MapMarker handle={handle} lat={origin.lat} lng={origin.lng} anchor="bottom" zIndex={30}>
                <PropertyPin icon={propertyTypeIcon(property)} label={property.name} />
              </MapMarker>
              {pinned.map((p) => {
                const isSelected = p.id === selected?.id;
                return (
                  <MapMarker key={p.id} handle={handle} lat={p.lat} lng={p.lng} anchor="center" zIndex={isSelected ? 40 : 10}>
                    <PlacePin
                      icon={placeIcon(p)}
                      name={p.name}
                      detail={formatKm(p.km)}
                      selected={isSelected}
                      showLabel={labelled.has(p.id)}
                      onSelect={() => selectPlace(p)}
                      actionLabel={`${p.name}, ${p.kind ?? PLACE_CATEGORY_LABELS[p.category]}, ${formatKm(p.km)} away`}
                    />
                  </MapMarker>
                );
              })}
            </>
          )}
        </MapFrame>
      </section>
      <LocalityPanel
        bundle={bundle}
        category={category}
        places={inCategory}
        selectedId={selected?.id ?? null}
        onSelect={selectPlace}
        onProfile={() => show({ category: null, placeId: null })}
      />
    </div>
  );
}

import { useEffect, useMemo } from 'react';
import { MapPin } from 'lucide-react';
import { formatKm, formatMinutes, type CommuteRoute, type LngLatPair, type PropertyBundle, type SessionAction, type ViewParams } from '@ave/shared';
import { propertyTypeIcon } from '@/ui';
import type { ViewProps } from '../types';
import { MapFrame } from '../maps/MapFrame';
import { MapMarker } from '../maps/MapMarker';
import { PlacePin, PropertyPin } from '../maps/pins';
import { MAP_PADDING, fitPoints } from '../maps/camera';
import { measureText } from '../maps/labels';
import { setRoute } from '../maps/engine';
import { COMMUTE_CATEGORY_ICONS } from '../maps/icons';
import { useMapHost } from '../maps/useMapHost';
import { LABEL_FONT, useVisibleLabels, type LabelItem } from '../maps/useVisibleLabels';
import { startMapPreloading } from '../maps/preload';
import { selectRoute } from './activeRoute';
import { CommutePanel } from './CommutePanel';

startMapPreloading();

/** A route fills the frame up to this zoom; short hops stay readable rather than street-level. */
const ROUTE_MAX_ZOOM = 15;
/** Pin, gap, tag padding and a margin around the destination's name tag. */
const DESTINATION_TAG_ROOM_PX = 72;

/** Commute view: drive routes from the property to presets and to any place the buyer names. */
export default function CommuteView({ state, bundle, dispatch }: ViewProps) {
  if (!bundle) return null;
  return <Commute bundle={bundle} params={state.params.commute} dispatch={dispatch} />;
}

interface CommuteProps {
  bundle: PropertyBundle;
  params: ViewParams['commute'];
  dispatch: (action: SessionAction) => void;
}

const routeDetail = (r: { distanceKm: number; durationMin: number }) => `${formatKm(r.distanceKm)} · ${formatMinutes(r.durationMin)}`;

function Commute({ bundle, params, dispatch }: CommuteProps) {
  const { property, commute } = bundle;
  const origin = property.location;
  const { hostRef, handle } = useMapHost(origin);
  const selection = useMemo(() => selectRoute(commute, params), [commute, params]);
  const active = selection.status === 'route' ? selection.route : null;

  const choose = (route: CommuteRoute) =>
    dispatch({ type: 'set_view', view: 'commute', params: { destinationId: route.id === params.destinationId ? null : route.id, custom: null } });

  // Route line and camera follow the selection.
  useEffect(() => {
    if (!handle) return;
    const home: LngLatPair = [origin.lng, origin.lat];
    if (active) {
      setRoute(active.geometry);
      const dest: LngLatPair = [active.destination.lng, active.destination.lat];
      // Leave room on the right for the destination's name tag.
      const tag = measureText(`${active.label}  ${routeDetail(active)}`, LABEL_FONT) + DESTINATION_TAG_ROOM_PX;
      const padding = { ...MAP_PADDING, right: Math.max(MAP_PADDING.right, tag) };
      fitPoints(handle.map, [home, dest, ...active.geometry], { maxZoom: ROUTE_MAX_ZOOM, padding });
    } else {
      setRoute(null);
      fitPoints(handle.map, [home, ...commute.routes.map((r): LngLatPair => [r.destination.lng, r.destination.lat])], { maxZoom: ROUTE_MAX_ZOOM });
    }
    // Re-frame only when the property or the chosen route changes.
  }, [handle, property.id, active?.key]);

  const showingRoute = active !== null;
  const overviewLabels = useMemo<LabelItem[]>(
    () =>
      showingRoute
        ? []
        : commute.routes.map((r, i) => ({ id: r.id, lat: r.destination.lat, lng: r.destination.lng, text: `${r.label}  ${routeDetail(r)}`, priority: i })),
    [showingRoute, commute.routes],
  );
  const labelled = useVisibleLabels(handle, overviewLabels, { ...origin, label: property.name });

  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_minmax(300px,31%)]">
      <section className="flex min-h-0 flex-col" aria-label="Commute map">
        <MapFrame hostRef={hostRef} handle={handle} fallbackHint="Distances and drive times are listed alongside.">
          {handle && (
            <>
              <MapMarker handle={handle} lat={origin.lat} lng={origin.lng} anchor="bottom" zIndex={30}>
                <PropertyPin icon={propertyTypeIcon(property)} label={property.name} />
              </MapMarker>
              {active ? (
                <MapMarker key={active.key} handle={handle} lat={active.destination.lat} lng={active.destination.lng} anchor="center" zIndex={40}>
                  <PlacePin
                    icon={active.category ? COMMUTE_CATEGORY_ICONS[active.category] : MapPin}
                    name={active.label}
                    detail={routeDetail(active)}
                    selected
                    showLabel
                  />
                </MapMarker>
              ) : (
                commute.routes.map((r) => (
                  <MapMarker key={r.id} handle={handle} lat={r.destination.lat} lng={r.destination.lng} anchor="center" zIndex={10}>
                    <PlacePin
                      icon={COMMUTE_CATEGORY_ICONS[r.category]}
                      name={r.label}
                      detail={routeDetail(r)}
                      showLabel={labelled.has(r.id)}
                      onSelect={() => choose(r)}
                      actionLabel={`Show the drive to ${r.destination.name}, ${routeDetail(r)}`}
                    />
                  </MapMarker>
                ))
              )}
            </>
          )}
        </MapFrame>
      </section>
      <CommutePanel bundle={bundle} selection={selection} activeId={params.destinationId} onChoose={choose} />
    </div>
  );
}

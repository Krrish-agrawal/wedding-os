import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Marker, PositionAnchor } from 'maplibre-gl';
import type { MapHandle } from './engine';

interface MapMarkerProps {
  handle: MapHandle;
  lat: number;
  lng: number;
  /** Which part of the content sits on the coordinate. */
  anchor?: PositionAnchor;
  /** Higher draws on top: the selected pin and the property sit above the rest. */
  zIndex?: number;
  children: ReactNode;
}

/**
 * Renders React content as a map marker. MapLibre keeps it positioned while the map moves;
 * React owns what is inside it, so names, distances and selection stay declarative.
 */
export function MapMarker({ handle, lat, lng, anchor = 'bottom', zIndex = 1, children }: MapMarkerProps) {
  const [element] = useState(() => document.createElement('div'));
  const markerRef = useRef<Marker | null>(null);

  useLayoutEffect(() => {
    const marker = new handle.lib.Marker({ element, anchor }).setLngLat([lng, lat]).addTo(handle.map);
    markerRef.current = marker;
    return () => {
      marker.remove();
      markerRef.current = null;
    };
    // Position updates are handled below without recreating the marker, which would flicker.
  }, [handle, element, anchor]);

  useLayoutEffect(() => {
    markerRef.current?.setLngLat([lng, lat]);
  }, [lng, lat]);

  useLayoutEffect(() => {
    element.style.zIndex = String(zIndex);
  }, [element, zIndex]);

  return createPortal(children, element);
}

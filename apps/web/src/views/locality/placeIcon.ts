import { Bus, TrainFront, type LucideIcon } from 'lucide-react';
import type { Place } from '@ave/shared';
import { PLACE_CATEGORY_ICONS } from '../maps/icons';

/** Category icon, refined for transit so bus stops and railway stations read differently from metro. */
export function placeIcon(place: Pick<Place, 'category'> & { kind?: string }): LucideIcon {
  if (place.category === 'transit') {
    if (place.kind && /bus/i.test(place.kind)) return Bus;
    if (place.kind && /railway/i.test(place.kind)) return TrainFront;
  }
  return PLACE_CATEGORY_ICONS[place.category];
}

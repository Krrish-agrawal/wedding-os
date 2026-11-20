import { Building2, House, type LucideIcon } from 'lucide-react';
import type { Property } from '@ave/shared';

/** The icon that stands for a property's type: a house for sale homes, a building for leased offices. */
export function propertyTypeIcon(property: Pick<Property, 'kind'>): LucideIcon {
  return property.kind === 'lease' ? Building2 : House;
}

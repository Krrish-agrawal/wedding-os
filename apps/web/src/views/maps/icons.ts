import { Briefcase, Building2, Bus, House, Hospital, Landmark, Plane, School, ShoppingBasket, TrainFront, TramFront, Trees, UtensilsCrossed, type LucideIcon } from 'lucide-react';
import type { CommuteRoute, PlaceCategory } from '@ave/shared';

export const PLACE_CATEGORY_ICONS: Record<PlaceCategory, LucideIcon> = {
  schools: School,
  hospitals: Hospital,
  transit: TramFront,
  groceries: ShoppingBasket,
  parks: Trees,
  dining: UtensilsCrossed,
};

export const COMMUTE_CATEGORY_ICONS: Record<CommuteRoute['category'], LucideIcon> = {
  airport: Plane,
  bus: Bus,
  rail: TrainFront,
  metro: TramFront,
  cbd: Landmark,
  techpark: Building2,
  office: Briefcase,
  home: House,
};

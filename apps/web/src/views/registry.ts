import { Box, CalendarCheck, FileCheck, IndianRupee, LayoutGrid, MapPin, Route, Sun, Zap } from 'lucide-react';
import type { ViewId } from '@ave/shared';
import type { ViewModule } from './types';
import ShortlistView from './shortlist/ShortlistView';
import TourView from './tour/TourView';
import BlueprintView from './blueprint/BlueprintView';
import LocalityView from './locality/LocalityView';
import CommuteView from './commute/CommuteView';
import CompassView from './compass/CompassView';
import MoneyView from './money/MoneyView';
import LegalView from './legal/LegalView';
import BookingView from './booking/BookingView';

/** Every stage view, in dock order. Each view owns one accent colour. */
export const VIEWS: Record<ViewId, ViewModule> = {
  shortlist: { id: 'shortlist', Component: ShortlistView, accent: 'blue', icon: LayoutGrid, needsProperty: false },
  tour: { id: 'tour', Component: TourView, accent: 'blue', icon: Box, needsProperty: true },
  blueprint: { id: 'blueprint', Component: BlueprintView, accent: 'grape', icon: Zap, needsProperty: true },
  locality: { id: 'locality', Component: LocalityView, accent: 'tangerine', icon: MapPin, needsProperty: true },
  commute: { id: 'commute', Component: CommuteView, accent: 'tangerine', icon: Route, needsProperty: true },
  compass: { id: 'compass', Component: CompassView, accent: 'sun', icon: Sun, needsProperty: true },
  money: { id: 'money', Component: MoneyView, accent: 'coral', icon: IndianRupee, needsProperty: true },
  legal: { id: 'legal', Component: LegalView, accent: 'mint', icon: FileCheck, needsProperty: true },
  booking: { id: 'booking', Component: BookingView, accent: 'mint', icon: CalendarCheck, needsProperty: true },
};

export const VIEW_ORDER: ViewId[] = ['shortlist', 'tour', 'blueprint', 'locality', 'commute', 'compass', 'money', 'legal', 'booking'];

import type { BlueprintLayer, CompassOverlay, MoneyTab, PlaceCategory, ViewId } from './views.js';

export const VIEW_LABELS: Record<ViewId, string> = {
  shortlist: 'Shortlist',
  tour: '3D tour',
  blueprint: 'Blueprint',
  locality: 'Locality',
  commute: 'Commute',
  compass: 'Sun & Vastu',
  money: 'Pricing',
  legal: 'Legal',
  booking: 'Site visit',
};

/** Presenter keyboard shortcuts: digit key -> view. */
export const VIEW_HOTKEYS: Record<string, ViewId> = {
  '1': 'shortlist',
  '2': 'tour',
  '3': 'blueprint',
  '4': 'locality',
  '5': 'commute',
  '6': 'compass',
  '7': 'money',
  '8': 'legal',
  '9': 'booking',
};
/** Presenter key that switches to the other property. */
export const PROPERTY_TOGGLE_HOTKEY = '0';

export const BLUEPRINT_LAYER_LABELS: Record<BlueprintLayer, string> = {
  layout: 'Layout',
  electrical: 'Electrical',
  plumbing: 'Plumbing',
};

export const PLACE_CATEGORY_LABELS: Record<PlaceCategory, string> = {
  schools: 'Schools',
  hospitals: 'Hospitals',
  transit: 'Metro & transit',
  groceries: 'Groceries',
  parks: 'Parks',
  dining: 'Dining',
};

export const COMPASS_OVERLAY_LABELS: Record<CompassOverlay, string> = {
  sun: 'Sunlight',
  vastu: 'Vastu',
  seating: 'Seating',
};

export const MONEY_TAB_LABELS: Record<MoneyTab, string> = {
  breakup: 'Price breakup',
  emi: 'EMI',
  offers: 'Offers',
  schedule: 'Payment schedule',
  lease: 'Lease terms',
};

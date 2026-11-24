import type { Vendor, VendorCategory, VendorPackage } from './schema.js';

/**
 * DEMO DATA. Every business below is fictional. Names, prices and capacities are invented to demonstrate the
 * marketplace; there are no real contact details, no reviews, no availability and no verification.
 * Images are `art:<key>` gradient artwork drawn by the app, not photographs.
 */
export const DEMO_DATA_LABEL = 'DEMO DATA';
export const DEMO_DATA_NOTICE = 'DEMO DATA: these vendors are fictional examples. They have no contact details, reviews or availability, and none is verified.';

const STAMP = '2026-11-01T00:00:00.000Z';

const pkg = (id: string, name: string, priceInr: number, pricingUnit: VendorPackage['pricingUnit'], includes: string[], extra: Partial<VendorPackage> = {}): VendorPackage =>
  ({ id, name, description: '', priceInr, pricingUnit, includes, ...extra });

interface Seed {
  id: string; name: string; category: VendorCategory; description: string; location: string; areas: string[]; spec: string[];
  cap: [number, number]; services: string[]; from: number; packages: VendorPackage[]; art: string;
}

const seeds: Seed[] = [
  { id: 'demo-mysore-mandap', name: 'Demo Mysore Mandap Works', category: 'decorator', location: 'Ramanagara', areas: ['Ramanagara', 'Channapatna', 'Bengaluru', 'Mysuru'],
    description: 'Traditional South Indian decor: banana-stem mandaps, jasmine and marigold garlands, brass lamps.', spec: ['Traditional South Indian', 'Temple style', 'Muhurtham decor'],
    cap: [100, 600], services: ['Mandap', 'Stage', 'Entrance arch', 'Floral garlands', 'Brass lamp styling'], from: 120_000, art: 'gold',
    packages: [pkg('muhurtham', 'Muhurtham Essentials', 120_000, 'flat', ['Traditional mandap', 'Entrance arch', 'Garlands']), pkg('grand-south', 'Grand South Indian', 190_000, 'flat', ['Mandap with banana-stem pillars', 'Stage backdrop', 'Entrance arch', '2 floral arrangements', 'Brass lamps'], { minGuests: 150 })] },
  { id: 'demo-channapatna-florals', name: 'Demo Channapatna Floral Studio', category: 'decorator', location: 'Channapatna', areas: ['Channapatna', 'Ramanagara', 'Bengaluru'],
    description: 'Flower-forward traditional decor with locally sourced jasmine, rose and marigold.', spec: ['Traditional South Indian', 'Floral'],
    cap: [80, 400], services: ['Mandap', 'Floral wall', 'Garlands', 'Pathway decor'], from: 90_000, art: 'rose',
    packages: [pkg('classic-floral', 'Classic Floral', 90_000, 'flat', ['Floral mandap', 'Garlands', 'Pathway flowers']), pkg('floral-plus', 'Floral Plus', 165_000, 'flat', ['Floral mandap', 'Floral wall panel', 'Stage styling', 'Entrance arch'])] },
  { id: 'demo-ramanagara-royal', name: 'Demo Ramanagara Royal Events', category: 'decorator', location: 'Ramanagara', areas: ['Ramanagara', 'Bengaluru', 'Mysuru'],
    description: 'Grand-scale traditional weddings with elaborate stage and entrance design.', spec: ['Traditional South Indian', 'Royal', 'Large weddings'],
    cap: [250, 1200], services: ['Mandap', 'Grand stage', 'Entrance arch', 'Chandeliers', 'Lighting'], from: 280_000, art: 'ruby',
    packages: [pkg('royal-standard', 'Royal Standard', 280_000, 'flat', ['Mandap', 'Grand stage', 'Entrance arch', 'Chandeliers'], { minGuests: 250 }), pkg('royal-signature', 'Royal Signature', 520_000, 'flat', ['Everything in Standard', 'Floral wall', 'Fairy-light ceiling', 'Pathway lanterns'], { minGuests: 300 })] },
  { id: 'demo-lumiere-luxe', name: 'Demo Lumière Luxury Decor', category: 'decorator', location: 'Bengaluru', areas: ['Bengaluru', 'Ramanagara', 'Mysuru'],
    description: 'Contemporary luxury styling: crystal, white florals, sculpted lighting.', spec: ['Luxury', 'Contemporary', 'White and gold'],
    cap: [100, 500], services: ['Stage', 'Mandap', 'Chandeliers', 'Lighting design', 'Floral installations'], from: 450_000, art: 'ivory',
    packages: [pkg('luxe-evening', 'Luxe Evening', 450_000, 'flat', ['Modern mandap', 'Stage', 'Lighting design']), pkg('luxe-atelier', 'Atelier Collection', 900_000, 'flat', ['Full venue transformation', 'Crystal chandeliers', 'Floral installations', 'Dedicated design lead'])] },
  { id: 'demo-bengaluru-bloom', name: 'Demo Bengaluru Bloom & Co', category: 'florist', location: 'Bengaluru', areas: ['Bengaluru', 'Ramanagara'],
    description: 'Fresh-flower garlands, bouquets and centrepieces.', spec: ['Garlands', 'Bouquets', 'Centrepieces'],
    cap: [20, 800], services: ['Garlands', 'Bridal bouquet', 'Centrepieces', 'Car decor'], from: 25_000, art: 'leaf',
    packages: [pkg('garlands', 'Garland Set', 25_000, 'flat', ['Varmala pair', 'Bridal bouquet', '10 small garlands']), pkg('centrepieces', 'Centrepiece Pack', 60_000, 'flat', ['10 table centrepieces', 'Welcome flowers'])] },
  { id: 'demo-saffron-table', name: 'Demo Saffron Table Caterers', category: 'caterer', location: 'Bengaluru', areas: ['Bengaluru', 'Ramanagara', 'Channapatna'],
    description: 'South Indian vegetarian wedding feasts served on banana leaf.', spec: ['South Indian vegetarian', 'Banana-leaf service', 'Live dosa counters'],
    cap: [100, 1500], services: ['Lunch', 'Dinner', 'Live counters', 'Service staff'], from: 650, art: 'saffron',
    packages: [pkg('feast', 'Banana-Leaf Feast', 650, 'per_guest', ['Lunch for guests', 'Service staff'], { minGuests: 100 }), pkg('feast-live', 'Feast + Live Counters', 950, 'per_guest', ['Lunch', '2 live counters', 'Dessert bar'], { minGuests: 150 })] },
  { id: 'demo-grand-spice', name: 'Demo Grand Spice Banquets', category: 'caterer', location: 'Bengaluru', areas: ['Bengaluru', 'Mysuru'],
    description: 'Multi-cuisine catering: North Indian, South Indian and Continental.', spec: ['Multi-cuisine', 'Large guest lists'],
    cap: [200, 2000], services: ['Multi-cuisine buffet', 'Live counters', 'Service staff'], from: 1_100, art: 'ruby',
    packages: [pkg('buffet', 'Multi-Cuisine Buffet', 1_100, 'per_guest', ['Buffet', 'Service staff'], { minGuests: 200 }), pkg('premium', 'Premium Buffet', 1_600, 'per_guest', ['Buffet', 'Live counters', 'Dessert bar', 'Mocktail bar'], { minGuests: 250 })] },
  { id: 'demo-frame-and-thread', name: 'Demo Frame & Thread Photography', category: 'photographer', location: 'Bengaluru', areas: ['Bengaluru', 'Ramanagara', 'Mysuru', 'Channapatna'],
    description: 'Candid and traditional wedding photography.', spec: ['Candid', 'Traditional', 'Pre-wedding'],
    cap: [0, 2000], services: ['Photography', 'Album', 'Pre-wedding shoot'], from: 80_000, art: 'ink',
    packages: [pkg('one-day', 'One-Day Coverage', 80_000, 'flat', ['1 photographer', 'Edited gallery']), pkg('two-day', 'Two-Day Coverage', 150_000, 'flat', ['2 photographers', 'Edited gallery', 'Album'])] },
  { id: 'demo-ramanagara-reels', name: 'Demo Ramanagara Reels', category: 'videographer', location: 'Ramanagara', areas: ['Ramanagara', 'Bengaluru'],
    description: 'Cinematic wedding films and drone coverage.', spec: ['Cinematic', 'Drone'],
    cap: [0, 2000], services: ['Highlight film', 'Full film', 'Drone'], from: 70_000, art: 'ink',
    packages: [pkg('highlight', 'Highlight Film', 70_000, 'flat', ['5-minute film', '1 videographer']), pkg('cinematic', 'Cinematic Package', 140_000, 'flat', ['Highlight film', 'Full film', 'Drone'])] },
  { id: 'demo-glow-studio', name: 'Demo Glow Bridal Studio', category: 'makeup', location: 'Bengaluru', areas: ['Bengaluru', 'Ramanagara', 'Channapatna'],
    description: 'Bridal makeup and hair, including traditional South Indian looks.', spec: ['Bridal', 'South Indian bridal', 'HD makeup'],
    cap: [0, 50], services: ['Bridal makeup', 'Hair styling', 'Draping assistance'], from: 25_000, art: 'rose',
    packages: [pkg('bridal', 'Bridal Look', 25_000, 'flat', ['Makeup', 'Hair', 'Draping']), pkg('bridal-family', 'Bridal + Family', 48_000, 'flat', ['Bridal look', '3 family members'])] },
  { id: 'demo-beat-bridge', name: 'Demo Beat Bridge Entertainment', category: 'entertainer', location: 'Bengaluru', areas: ['Bengaluru', 'Ramanagara', 'Mysuru'],
    description: 'DJ, sound and sangeet emcee.', spec: ['DJ', 'Sangeet'],
    cap: [50, 1000], services: ['DJ', 'Sound system', 'Emcee'], from: 40_000, art: 'indigo',
    packages: [pkg('dj-night', 'DJ Night', 40_000, 'flat', ['DJ', 'Sound', 'Basic lighting']), pkg('sangeet', 'Sangeet Package', 85_000, 'flat', ['DJ', 'Emcee', 'Dance floor lighting'])] },
  { id: 'demo-knot-and-vow', name: 'Demo Knot & Vow Planners', category: 'planner', location: 'Bengaluru', areas: ['Bengaluru', 'Ramanagara', 'Mysuru'],
    description: 'Full-service wedding planning and on-day coordination.', spec: ['Full planning', 'Day-of coordination'],
    cap: [50, 800], services: ['Planning', 'Vendor coordination', 'Day-of coordination'], from: 100_000, art: 'indigo',
    packages: [pkg('day-of', 'Day-Of Coordination', 100_000, 'flat', ['Coordinator on the day']), pkg('full', 'Full Planning', 300_000, 'flat', ['Planning', 'Vendor coordination', 'Day-of team'])] },
  { id: 'demo-silk-route-venue', name: 'Demo Silk Route Convention Hall', category: 'venue', location: 'Ramanagara', areas: ['Ramanagara'],
    description: 'Indoor hall with a stage bay and parking.', spec: ['Indoor', 'Large weddings'],
    cap: [150, 700], services: ['Hall hire', 'Stage bay', 'Parking'], from: 200_000, art: 'gold',
    packages: [pkg('hall-day', 'Hall, one day', 200_000, 'flat', ['Hall', 'Stage bay', 'Parking'])] },
];

export const DEMO_VENDORS: readonly Vendor[] = seeds.map((s): Vendor => ({
  id: s.id, businessName: s.name, category: s.category, description: s.description, logo: `art:${s.art}`, portfolio: [`art:${s.art}`, 'art:ivory', 'art:leaf'],
  location: s.location, serviceAreas: s.areas, specialisations: s.spec, capacity: { min: s.cap[0], max: s.cap[1] }, services: s.services, startingPriceInr: s.from, packages: s.packages,
  availability: { bookedDates: [], note: 'No availability has been supplied. Ask the vendor.', provided: false, updatedAt: null },
  verification: { status: 'unverified', verifiedAt: null, verifiedBy: null },
  reviews: null, source: 'demo', createdAt: STAMP, updatedAt: STAMP,
}));

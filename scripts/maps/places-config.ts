/**
 * How OpenStreetMap features become locality places. Tuned for a buyer's view of the area:
 * a handful of named, nearby places per category, spread out enough to read on a map.
 */
import type { PlaceCategory } from '@ave/shared';

export const OVERPASS_URL = process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter';
/** Server-side time limit declared in the query, in seconds. */
export const OVERPASS_TIMEOUT_S = 90;
/** Pause between localities so we never hold more than one Overpass slot. */
export const OVERPASS_PAUSE_MS = 10_000;

/** Search radius per category, in metres from the property. */
export const RADIUS_M: Record<PlaceCategory, number> = {
  schools: 2000,
  hospitals: 2500,
  transit: 1200,
  groceries: 1200,
  parks: 1500,
  dining: 900,
};
/** Metro and railway stations are searched wider: the nearest one matters even if it is a drive away. */
export const STATION_RADIUS_M = 4000;
/** Bus stations (depots, TTMCs) are worth showing a little further out than ordinary stops. */
export const BUS_STATION_RADIUS_M = 2000;

/** Places kept per category (the brief asks for about 6 to 10). Schools get more room: preschools crowd the nearest spots. */
export const MAX_PER_CATEGORY = 8;
export const MAX_SCHOOLS = 10;
/** Groceries lead with supermarkets, then fill with greengrocers and corner stores by distance. */
export const MAX_SUPERMARKETS = 4;
/** Within transit: at most this many metro stations, railway stations and bus stops. */
export const MAX_METRO_STATIONS = 2;
export const MAX_RAIL_STATIONS = 1;
export const MAX_BUS_STOPS = 4;
/** Picks closer than this to an already chosen place of the same category are skipped, so pins stay legible. */
export const MIN_SPACING_M = 120;
/** Same-name features closer than this are one place (both sides of a road, a node and its building). */
export const SAME_NAME_RADIUS_M = 600;
export const NAME_MIN_LENGTH = 3;
export const NAME_MAX_LENGTH = 60;

export interface Classified {
  category: PlaceCategory;
  kind: string;
  /** Sub-group used for the transit mix. */
  group?: 'metro' | 'rail' | 'bus_station' | 'bus_stop';
}

type Tags = Record<string, string>;

const GROCERY_KINDS: Record<string, string> = {
  supermarket: 'Supermarket',
  convenience: 'Convenience store',
  greengrocer: 'Greengrocer',
  grocery: 'Grocery store',
};

/** Lifecycle prefixes and values that mean the feature is not in use. */
function isInactive(t: Tags): boolean {
  if (t.railway === 'construction' || t.railway === 'proposed' || t.railway === 'disused' || t.railway === 'abandoned') return true;
  if (t.construction || t.proposed || t.disused === 'yes' || t.abandoned === 'yes') return true;
  return Object.keys(t).some((k) => /^(construction|proposed|disused|abandoned|demolished|was):/.test(k));
}

function isMetro(t: Tags): boolean {
  return (
    t.station === 'subway' ||
    t.station === 'light_rail' ||
    t.subway === 'yes' ||
    /namma metro|bmrcl|bangalore metro/i.test(`${t.network ?? ''} ${t.operator ?? ''}`)
  );
}

/** Maps OSM tags to a place category and a short type label, or null if the feature is not wanted. */
export function classify(t: Tags): Classified | null {
  if (isInactive(t)) return null;
  if (t.access === 'private' || t.access === 'no') return null;

  if (t.amenity === 'school') return { category: 'schools', kind: 'School' };
  if (t.amenity === 'hospital' || t.healthcare === 'hospital') return { category: 'hospitals', kind: 'Hospital' };

  if (t.railway === 'station' || (t.public_transport === 'station' && (t.train === 'yes' || t.subway === 'yes'))) {
    return isMetro(t)
      ? { category: 'transit', kind: 'Metro station', group: 'metro' }
      : { category: 'transit', kind: 'Railway station', group: 'rail' };
  }
  if (t.amenity === 'bus_station') return { category: 'transit', kind: 'Bus station', group: 'bus_station' };
  if (t.highway === 'bus_stop') return { category: 'transit', kind: 'Bus stop', group: 'bus_stop' };

  const grocery = t.shop ? GROCERY_KINDS[t.shop] : undefined;
  if (grocery) return { category: 'groceries', kind: grocery };

  if (t.leisure === 'park') return { category: 'parks', kind: 'Park' };
  if (t.leisure === 'garden' && t['garden:type'] !== 'residential') return { category: 'parks', kind: 'Garden' };

  if (t.amenity === 'restaurant') return { category: 'dining', kind: 'Restaurant' };
  if (t.amenity === 'cafe') return { category: 'dining', kind: 'Cafe' };
  return null;
}

/** Names that are only a type, not a place. */
const GENERIC_NAME = /^(bus ?stop|bus stand|school|park|garden|hospital|restaurant|cafe|metro|metro station|station|shop|store|supermarket|playground)$/i;
const LATIN = /[a-z]/i;
/**
 * School names from a bulk import use clipped forms ("Holy Saint Eng Sch", "GHPS ...", "Mes HS").
 * We show OSM names as they are, so those entries are skipped rather than guessed at.
 */
const ABBREVIATED_SCHOOL_NAME = /\b(Eng|Sch|E?HPS|[GK]HPS|GLPS|GMPS|LPS|HS)\b/;

/** True for names that should not be shown for this category. */
export function isUnusableName(category: PlaceCategory, name: string): boolean {
  return category === 'schools' && ABBREVIATED_SCHOOL_NAME.test(name);
}

/** The English display name, or null when there is no usable one. */
export function displayName(t: Tags): string | null {
  const candidates = [t['name:en'], t.name].filter((n): n is string => Boolean(n));
  for (const raw of candidates) {
    // Corporate suffixes such as "(Unit Of Rhea Healthcare Pvt Ltd)" add nothing for a buyer.
    const name = raw.replace(/\s*\((?:a )?unit of [^)]*\)/i, '').trim().replace(/\s+/g, ' ');
    if (name.length < NAME_MIN_LENGTH || name.length > NAME_MAX_LENGTH) continue;
    if (!LATIN.test(name) || GENERIC_NAME.test(name)) continue;
    return name;
  }
  return null;
}

/**
 * Features dropped after reviewing the fetched output, keyed by OSM id, with the reason.
 * Add to this list when a place is mislabelled, closed, or not useful to a buyer.
 */
export const EXCLUDED_OSM_IDS: Record<string, string> = {
  // Indiranagar
  'node/3370167135': 'DQ Labs is a company office tagged as a school',
  'way/1517117856': 'school name uses outdated wording; not a general school for a buyer',
  'node/13817232442': 'a clinic tagged as a hospital',
  'node/3370244392': 'a clinic tagged as a hospital',
  'node/7572526687': 'an eye and dental clinic tagged as a hospital',
  'way/331365081': 'a fertility clinic tagged as a hospital',
  'way/330471450': '"BDA Public Site" is a land parcel label, not a park name',
  'way/345964025': 'an ayurveda wellness centre tagged as a hospital',
  'way/331330194': 'a fine-arts institute tagged as a school',
  'way/41499025': 'a disability charity campus tagged as a school',
  'node/3370279041': 'a business college tagged as a school',
  'node/2198227768': 'a mobile phone shop tagged as a convenience store',
  // Koramangala
  'node/8428403226': "a ward of St. John's Medical College Hospital, which is listed itself",
  'node/6944525392': 'duplicate of Prasad Eye Hospital',
  'node/3463769188': 'a tuition centre tagged as a school',
  'node/1474351217': 'a sports shop tagged as a convenience store',
  'node/1469643919': 'a baby products shop tagged as a convenience store',
  'node/1470523370': 'a footwear shop tagged as a convenience store',
  'node/1468190779': 'a baby products shop tagged as a convenience store',
  'node/1474324424': 'a courier office tagged as a convenience store',
  'node/1470628756': 'a snack shop tagged as a convenience store',
  'node/1470634295': 'a snack shop tagged as a convenience store',
  'node/1474324438': 'a stationery shop tagged as a convenience store',
  'node/1465777960': 'a bakery tagged as a convenience store',
  'way/1160859551': '"BBMP Park" is a generic label, not a park name',
  'node/6349591431': 'name is unclear and matches no school we could identify',
  'way/1242193149': 'second entry for Christ School, which is listed once',
};

const M_PER_DEG_LAT = 111_320;

/** South, west, north, east of a square around a point, for Overpass's cheap bounding-box filter. */
function bboxAround(lat: number, lng: number, radiusM: number): string {
  const dLat = radiusM / M_PER_DEG_LAT;
  const dLng = radiusM / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
  const f = (n: number) => n.toFixed(5);
  return `(${f(lat - dLat)},${f(lng - dLng)},${f(lat + dLat)},${f(lng + dLng)})`;
}

/** Radius a classified feature must fall within, in metres. Stations are searched wider. */
export function radiusFor(c: Classified): number {
  if (c.group === 'metro' || c.group === 'rail') return STATION_RADIUS_M;
  if (c.group === 'bus_station') return BUS_STATION_RADIUS_M;
  return RADIUS_M[c.category];
}

/**
 * Overpass QL for one locality: every category in one request. Bounding boxes keep the query light
 * on the server; the exact radius is applied locally afterwards (see radiusFor).
 */
export function buildQuery(lat: number, lng: number): string {
  const box = (r: number) => bboxAround(lat, lng, r);
  return `[out:json][timeout:${OVERPASS_TIMEOUT_S}];
(
  nwr[amenity=school][name]${box(RADIUS_M.schools)};
  nwr[amenity=hospital][name]${box(RADIUS_M.hospitals)};
  nwr[healthcare=hospital][name]${box(RADIUS_M.hospitals)};
  nwr[railway=station][name]${box(STATION_RADIUS_M)};
  nwr[public_transport=station][name]${box(STATION_RADIUS_M)};
  nwr[amenity=bus_station][name]${box(BUS_STATION_RADIUS_M)};
  node[highway=bus_stop][name]${box(RADIUS_M.transit)};
  nwr[shop~"^(supermarket|convenience|greengrocer|grocery)$"][name]${box(RADIUS_M.groceries)};
  nwr[leisure~"^(park|garden)$"][name]${box(RADIUS_M.parks)};
  nwr[amenity~"^(restaurant|cafe)$"][name]${box(RADIUS_M.dining)};
);
out tags center;`;
}

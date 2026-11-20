/** Indian number formatting for display and for speech. */

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/** ₹1,28,00,000 */
export function formatINR(amount: number): string {
  return inr.format(Math.round(amount));
}

/** 1,28,00,000 */
export function formatIndianNumber(n: number): string {
  return num.format(Math.round(n));
}

const CRORE = 1_00_00_000;
const LAKH = 1_00_000;

/** ₹1.28 Cr, ₹45.5 L, ₹38,000 */
export function formatINRShort(amount: number): string {
  const a = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  if (a >= CRORE) return `${sign}₹${trimZeros((a / CRORE).toFixed(2))} Cr`;
  if (a >= LAKH) return `${sign}₹${trimZeros((a / LAKH).toFixed(2))} L`;
  return `${sign}${formatINR(a)}`;
}

/** "1.28 crore", "45.5 lakh", "38 thousand rupees" — how the advisor should say amounts. */
export function speakINR(amount: number): string {
  const a = Math.abs(Math.round(amount));
  if (a >= CRORE) return `${trimZeros((a / CRORE).toFixed(2))} crore rupees`;
  if (a >= LAKH) return `${trimZeros((a / LAKH).toFixed(2))} lakh rupees`;
  if (a >= 1000) return `${trimZeros((a / 1000).toFixed(1))} thousand rupees`;
  return `${a} rupees`;
}

export function formatKm(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${trimZeros(km.toFixed(1))} km`;
}

export function formatMinutes(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/** 0..1439 -> "9:30 AM" */
export function formatClock(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const ampm = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

/** "Floor 5 of 8", "Ground floor of 4", or the property's own label such as "Ground floor with mezzanine". */
export function formatFloor(floor: { level: number; of: number; label?: string }): string {
  if (floor.label) return floor.label;
  if (floor.level === 0) return floor.of > 1 ? `Ground floor of ${floor.of}` : 'Ground floor';
  return `Floor ${floor.level} of ${floor.of}`;
}

export function formatSqft(sqft: number): string {
  return `${formatIndianNumber(sqft)} sq ft`;
}

function trimZeros(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/** Great-circle distance in km. */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function toRad(d: number): number {
  return (d * Math.PI) / 180;
}

const UNIT_MULTIPLIERS: { pattern: RegExp; factor: number }[] = [
  { pattern: /^(crores?|cr|करोड़)$/i, factor: CRORE },
  { pattern: /^(lakhs?|lacs?|l|लाख)$/i, factor: LAKH },
  { pattern: /^(thousand|k|हज़ार|हजार)$/i, factor: 1000 },
];

/**
 * Reads an amount the way a buyer says it: "2 crore", "2.5 cr", "30 lakh", "30L", "₹2,00,00,000", "20000000".
 * Returns rupees, or null when the text is not an amount. Language models often slip a power of ten when
 * converting crore and lakh themselves, so tools accept the spoken form and convert here.
 */
export function parseINRAmount(text: string): number | null {
  const cleaned = text.trim().toLowerCase().replace(/₹|rs\.?|inr|rupees?/g, ' ').replace(/,/g, '').replace(/\s+/g, ' ').trim();
  const m = /^(\d+(?:\.\d+)?)\s*([^\d\s.]+)?$/.exec(cleaned);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return null;
  if (!m[2]) return Math.round(value);
  const unit = UNIT_MULTIPLIERS.find((u) => u.pattern.test(m[2]!));
  return unit ? Math.round(value * unit.factor) : null;
}

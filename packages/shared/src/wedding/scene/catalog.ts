import type { MOUNT_KINDS } from '../state.js';

/**
 * The decoration catalogue: pure data. The renderer maps `model` to a procedural builder, so a new GLB asset
 * is a new `model` id plus an entry here; nothing else in the scene logic changes.
 */

export type MountKind = (typeof MOUNT_KINDS)[number];
export type DecorCategory = 'mandap' | 'stage' | 'arch' | 'floral' | 'seating' | 'lighting' | 'table' | 'ritual';

export interface ColorPart {
  id: string;
  label: string;
  /** Default colour, `#rrggbb`. */
  color: string;
}

export interface CatalogEntry {
  id: string;
  name: string;
  category: DecorCategory;
  /** Metres at scale 1. */
  size: { width: number; depth: number; height: number };
  shape: 'box' | 'cylinder';
  /** The first mount is the default. */
  mounts: readonly MountKind[];
  /** Base height above the floor for wall-mounted pieces, metres. */
  wallY?: number;
  /** Key the renderer uses to build the model. */
  model: string;
  /** SAMPLE price in whole rupees per piece. Demonstration data, not a vendor quotation. */
  samplePrice: number;
  parts: readonly ColorPart[];
}

/** Shown wherever a sample price is shown. */
export const PRICE_NOTE = 'Sample prices for demonstration, not vendor quotations.';

export const MIN_SCALE = 0.5;
export const MAX_SCALE = 2.5;

export const DECOR_CATALOG: readonly CatalogEntry[] = [
  { id: 'mandap-traditional', name: 'Traditional mandap', category: 'mandap', size: { width: 4, depth: 4, height: 4.2 }, shape: 'box', mounts: ['floor', 'stage'], model: 'mandap-traditional', samplePrice: 75000, parts: [{ id: 'pillars', label: 'Pillars', color: '#c9a227' }, { id: 'flowers', label: 'Flowers', color: '#e8590c' }, { id: 'canopy', label: 'Canopy', color: '#b3123f' }] },
  { id: 'mandap-modern', name: 'Modern mandap', category: 'mandap', size: { width: 3.6, depth: 3.6, height: 3.6 }, shape: 'box', mounts: ['floor', 'stage'], model: 'mandap-modern', samplePrice: 85000, parts: [{ id: 'frame', label: 'Frame', color: '#f2f2f2' }, { id: 'flowers', label: 'Flowers', color: '#f4a3bd' }, { id: 'drapes', label: 'Drapes', color: '#f5efe6' }] },
  { id: 'stage-wedding', name: 'Wedding stage', category: 'stage', size: { width: 7, depth: 4, height: 0.6 }, shape: 'box', mounts: ['floor'], model: 'stage', samplePrice: 60000, parts: [{ id: 'platform', label: 'Platform', color: '#7a3b2e' }, { id: 'carpet', label: 'Carpet', color: '#9b1c31' }] },
  { id: 'arch-flower', name: 'Flower arch', category: 'arch', size: { width: 2.2, depth: 0.7, height: 2.7 }, shape: 'box', mounts: ['floor', 'stage'], model: 'arch', samplePrice: 18000, parts: [{ id: 'frame', label: 'Frame', color: '#d9c7a0' }, { id: 'flowers', label: 'Flowers', color: '#ec7aa3' }] },
  { id: 'flowers-centrepiece', name: 'Flower arrangement', category: 'floral', size: { width: 0.6, depth: 0.6, height: 0.9 }, shape: 'cylinder', mounts: ['floor', 'stage'], model: 'centrepiece', samplePrice: 12000, parts: [{ id: 'flowers', label: 'Flowers', color: '#f6c453' }, { id: 'vase', label: 'Vase', color: '#e9e4d8' }] },
  { id: 'flowers-wall-panel', name: 'Floral wall panel', category: 'floral', size: { width: 2.4, depth: 0.3, height: 2.2 }, shape: 'box', mounts: ['wall'], wallY: 0.6, model: 'wall-panel', samplePrice: 15000, parts: [{ id: 'flowers', label: 'Flowers', color: '#e85d75' }, { id: 'leaves', label: 'Leaves', color: '#3f7d4e' }] },
  { id: 'chair-banquet', name: 'Chair', category: 'seating', size: { width: 0.5, depth: 0.5, height: 0.95 }, shape: 'box', mounts: ['floor', 'stage'], model: 'chair', samplePrice: 600, parts: [{ id: 'seat', label: 'Seat', color: '#b3123f' }, { id: 'frame', label: 'Frame', color: '#c9a227' }] },
  { id: 'sofa-loveseat', name: 'Sofa', category: 'seating', size: { width: 1.8, depth: 0.85, height: 0.9 }, shape: 'box', mounts: ['floor', 'stage'], model: 'sofa', samplePrice: 8000, parts: [{ id: 'fabric', label: 'Fabric', color: '#f1e3c8' }, { id: 'frame', label: 'Frame', color: '#8a5a2b' }] },
  { id: 'chandelier-crystal', name: 'Chandelier', category: 'lighting', size: { width: 1.2, depth: 1.2, height: 1.4 }, shape: 'cylinder', mounts: ['ceiling'], model: 'chandelier', samplePrice: 25000, parts: [{ id: 'metal', label: 'Metal', color: '#c9a227' }, { id: 'glow', label: 'Light', color: '#ffe2a8' }] },
  { id: 'lights-fairy-curtain', name: 'Fairy-light curtain', category: 'lighting', size: { width: 2.5, depth: 0.1, height: 2.5 }, shape: 'box', mounts: ['wall'], wallY: 0.5, model: 'fairy-curtain', samplePrice: 8000, parts: [{ id: 'lights', label: 'Lights', color: '#ffd98a' }] },
  { id: 'lantern-floor', name: 'Floor lantern', category: 'lighting', size: { width: 0.45, depth: 0.45, height: 1.2 }, shape: 'cylinder', mounts: ['floor', 'stage'], model: 'lantern', samplePrice: 3000, parts: [{ id: 'body', label: 'Body', color: '#b08d57' }, { id: 'glow', label: 'Light', color: '#ffcf70' }] },
  { id: 'garland-marigold-curtain', name: 'Marigold garland curtain', category: 'floral', size: { width: 2.4, depth: 0.15, height: 2.6 }, shape: 'box', mounts: ['wall', 'ceiling'], wallY: 0.4, model: 'marigold-curtain', samplePrice: 9000, parts: [{ id: 'flowers', label: 'Marigolds', color: '#f5a623' }, { id: 'string', label: 'String', color: '#3f7d4e' }] },
  { id: 'lamp-brass-stand', name: 'Brass lamp stand', category: 'ritual', size: { width: 0.5, depth: 0.5, height: 1.5 }, shape: 'cylinder', mounts: ['floor', 'stage'], model: 'brass-lamp', samplePrice: 5500, parts: [{ id: 'brass', label: 'Brass', color: '#c9a227' }, { id: 'flame', label: 'Flame', color: '#ffcf70' }] },
  { id: 'aisle-runner-floral', name: 'Floral aisle runner', category: 'floral', size: { width: 1.6, depth: 8, height: 0.05 }, shape: 'box', mounts: ['floor'], model: 'aisle-runner', samplePrice: 22000, parts: [{ id: 'runner', label: 'Runner', color: '#b3123f' }, { id: 'petals', label: 'Petals', color: '#f6c453' }] },
  { id: 'table-round-banquet', name: 'Round banquet table', category: 'table', size: { width: 1.8, depth: 1.8, height: 0.8 }, shape: 'cylinder', mounts: ['floor'], model: 'round-table', samplePrice: 7000, parts: [{ id: 'cloth', label: 'Cloth', color: '#f5efe6' }, { id: 'centre', label: 'Centrepiece', color: '#ec7aa3' }] },
  { id: 'swing-jhula', name: 'Floral swing (jhula)', category: 'seating', size: { width: 2.2, depth: 1.4, height: 2.4 }, shape: 'box', mounts: ['floor', 'stage'], model: 'jhula', samplePrice: 38000, parts: [{ id: 'frame', label: 'Frame', color: '#8a5a2b' }, { id: 'seat', label: 'Seat', color: '#b3123f' }, { id: 'flowers', label: 'Flowers', color: '#f5a623' }] },
  { id: 'rangoli-floor', name: 'Rangoli', category: 'ritual', size: { width: 1.6, depth: 1.6, height: 0.05 }, shape: 'cylinder', mounts: ['floor', 'stage'], model: 'rangoli', samplePrice: 4000, parts: [{ id: 'outer', label: 'Outer ring', color: '#e8590c' }, { id: 'middle', label: 'Middle ring', color: '#ffd23f' }, { id: 'centre', label: 'Centre', color: '#7b61ff' }] },
  { id: 'plant-potted', name: 'Potted palm', category: 'floral', size: { width: 0.8, depth: 0.8, height: 1.4 }, shape: 'cylinder', mounts: ['floor', 'stage'], model: 'plant-potted', samplePrice: 4500, parts: [{ id: 'leaves', label: 'Leaves', color: '#3f7d4e' }, { id: 'pot', label: 'Pot', color: '#a8643a' }] },
  { id: 'urn-brass-flowers', name: 'Brass urn with flowers', category: 'floral', size: { width: 0.6, depth: 0.6, height: 1.2 }, shape: 'cylinder', mounts: ['floor', 'stage'], model: 'urn-flowers', samplePrice: 9000, parts: [{ id: 'brass', label: 'Brass', color: '#c9a227' }, { id: 'flowers', label: 'Flowers', color: '#f5a623' }] },
  { id: 'elephant-carved', name: 'Carved wooden elephant', category: 'ritual', size: { width: 0.7, depth: 1.2, height: 1.1 }, shape: 'box', mounts: ['floor', 'stage'], model: 'elephant', samplePrice: 16000, parts: [{ id: 'wood', label: 'Wood', color: '#8a5a2b' }, { id: 'trim', label: 'Gold trim', color: '#c9a227' }] },
];

export function findEntry(catalog: readonly CatalogEntry[], id: string): CatalogEntry | undefined {
  return catalog.find((e) => e.id === id);
}

/** Checks a catalogue: unique ids, sane sizes, non-empty mounts, wall pieces have a base height, unique part ids. */
export function validateCatalog(entries: readonly CatalogEntry[]): string | null {
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.id)) return `duplicate entry ${e.id}`;
    seen.add(e.id);
    const { width, depth, height } = e.size;
    if (![width, depth, height].every((v) => Number.isFinite(v) && v >= 0.05 && v <= 20)) return `bad size for ${e.id}`;
    if (e.mounts.length === 0) return `no mounts for ${e.id}`;
    if (!Number.isInteger(e.samplePrice) || e.samplePrice < 0) return `bad sample price for ${e.id}`;
    if (e.mounts.includes('wall') && e.wallY === undefined) return `wall piece ${e.id} needs wallY`;
    if (e.category === 'stage' && (e.mounts.length !== 1 || e.mounts[0] !== 'floor')) return `stage ${e.id} must be floor-only`;
    if (new Set(e.parts.map((p) => p.id)).size !== e.parts.length) return `duplicate part in ${e.id}`;
    if (!e.parts.every((p) => /^#[0-9a-f]{6}$/i.test(p.color))) return `bad colour in ${e.id}`;
  }
  return null;
}

import { DECOR_CATALOG, findEntry, type CatalogEntry } from '../scene/catalog.js';
import { resolveColor } from '../scene/colors.js';
import { costLines, sceneCost, suggestTrim, type CostLine } from '../scene/cost.js';
import { type StudioRoom } from '../scene/geometry.js';
import { addObject, elevate, validateAll, validateObject, type SceneContext } from '../scene/placement.js';
import type { DecorObject } from '../state.js';
import type { WeddingDesignBrief } from './brief.js';
import { AISLE_HALF_WIDTH, rectDepth, rectWidth, zonesFor, type Rect, type VenueZones } from './zones.js';

/**
 * Deterministic scene planning. Input: a design brief, the venue's real room, the guest count and a budget. Output: final,
 * validated decoration objects (positions computed from the room's zones, collision-checked with the same engine the
 * studio uses), plus an explanation of every substitution. The language model never sees or produces a coordinate.
 * Same input (including `variant`) always gives the same plan.
 */

export interface PlanPalette { role: 'primary' | 'secondary' | 'accent'; name: string; hex: string }
export interface ScenePlan {
  objects: DecorObject[];
  costInr: number;
  costLines: CostLine[];
  palette: PlanPalette[];
  /** Plain-language account of what was used instead of what was asked for. */
  substitutions: string[];
  notes: string[];
  description: string;
  seatsRequested: number;
  seatsShown: number;
  variant: number;
}
export type PlanResult = { ok: true; plan: ScenePlan } | { ok: false; error: string; hint: string };

export interface PlanInput {
  brief: WeddingDesignBrief;
  room: StudioRoom;
  guests: number;
  /** Decoration budget in rupees; null = no limit. */
  budgetInr: number | null;
  variant?: number;
  catalog?: readonly CatalogEntry[];
}

const FALLBACKS = { traditional: { primary: '#f5a623', secondary: '#7a1230', accent: '#c9a227' }, modern: { primary: '#fffdf2', secondary: '#f1e3c8', accent: '#c0c0c8' }, fusion: { primary: '#ec7aa3', secondary: '#fffdf2', accent: '#c9a227' } } as const;
const GRAND = (g: number, table: [number, number, number, number, number]) => table[Math.min(5, Math.max(1, g)) - 1]!;
const SEAT_CAP = [16, 24, 32, 40, 48] as const;
const snap = (v: number) => Math.round(v * 10) / 10;

const has = (b: WeddingDesignBrief, re: RegExp) => [b.style, b.summary, ...b.details, b.mandap.description, b.stage.description, b.entrance.description, b.ceiling.description].some((t) => re.test(t.toLowerCase()));

/** Colour for one part of a catalogue piece. Only parts we recognise are overridden; the rest keep the catalogue default. */
function partColour(partId: string, pal: Record<'primary' | 'secondary' | 'accent', string>, flower: string, light: string): string | null {
  if (/^(flowers?|blooms?|petals?|garland|garlands)$/.test(partId)) return flower;
  if (/^(pillars?|frame|metal|brass|body|rim|outer|ring)$/.test(partId)) return pal.accent;
  if (/^(canopy|drapes?|fabric|cloth|carpet|runner|seat|platform|inner)$/.test(partId)) return pal.secondary;
  if (/^(lights?|glow|bulbs?)$/.test(partId)) return light;
  return null;
}

export function planScene(input: PlanInput): PlanResult {
  const { brief, room, guests } = input;
  const catalog = input.catalog ?? DECOR_CATALOG;
  const variant = input.variant ?? 0;
  const ctx: SceneContext = { room, catalog };
  const z: VenueZones = zonesFor(room);
  const substitutions: string[] = [];
  const notes: string[] = [];
  const entry = (id: string) => findEntry(catalog, id);

  // ---- palette ---------------------------------------------------------------------------------------------------
  const fb = FALLBACKS[brief.tradition];
  const picked: Partial<Record<'primary' | 'secondary' | 'accent', { name: string; hex: string }>> = {};
  for (const p of brief.palette) {
    const hex = resolveColor(p.color);
    if (!hex) { substitutions.push(`The colour "${p.color}" is not in the studio's palette, so it was skipped.`); continue; }
    picked[p.role] ??= { name: p.color, hex };
  }
  let pal = { primary: picked.primary?.hex ?? fb.primary, secondary: picked.secondary?.hex ?? fb.secondary, accent: picked.accent?.hex ?? fb.accent };
  if (variant % 2 === 1) pal = { ...pal, secondary: pal.accent, accent: pal.secondary }; // another version swaps the supporting colours
  const palette: PlanPalette[] = (['primary', 'secondary', 'accent'] as const).map((role) => ({ role, name: picked[role]?.name ?? `${brief.tradition} default`, hex: pal[role] }));
  const light = brief.lighting.warmth === 'warm' ? '#ffcf70' : brief.lighting.warmth === 'cool' ? '#dfe9ff' : '#fff1c9';
  const flowerOf = (use: WeddingDesignBrief['flowers'][number]['use']) => {
    const f = brief.flowers.find((x) => x.use === use) ?? brief.flowers[0];
    return (f?.color && resolveColor(f.color)) || (f && /jasmine/i.test(f.name) ? resolveColor('jasmine') : f && /marigold/i.test(f.name) ? resolveColor('marigold') : null) || pal.primary;
  };
  for (const f of brief.flowers) if (!/marigold|jasmine|rose|flower|bloom|lotus|orchid|lily/i.test(f.name)) substitutions.push(`There is one generic flower model: "${f.name}" is shown as flowers in ${f.color ?? 'your primary colour'}.`);
  else if (!/jasmine|marigold|rose/i.test(f.name)) substitutions.push(`"${f.name}" is shown with the generic flower model, coloured to match.`);

  const colors = (e: CatalogEntry, flower = flowerOf('arrangements')): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const p of e.parts) { const c = partColour(p.id, pal, flower, light); if (c) out[p.id] = c; }
    return out;
  };

  // ---- placement helpers -----------------------------------------------------------------------------------------
  let acc: DecorObject[] = [];
  let n = 0;
  const nid = () => `ai-${++n}`;
  /** Floor and stage pieces go exactly where asked or not at all; wall and ceiling pieces take the nearest valid spot. */
  const place = (catalogId: string, mount: DecorObject['mount'], x: number, zz: number, rotationY = 0, flower?: string): boolean => {
    const e = entry(catalogId);
    if (!e || !e.mounts.includes(mount)) return false;
    if (mount === 'ceiling' && room.outdoor) return false;
    const colorsFor = colors(e, flower);
    if (mount === 'wall' || mount === 'ceiling') {
      const r = addObject(ctx, acc, { id: nid(), catalogId, mount, x, z: zz, colors: colorsFor });
      if (r.ok) acc = r.value;
      return r.ok;
    }
    const base: DecorObject = { id: nid(), catalogId, position: { x: snap(x), y: 0, z: snap(zz) }, rotationY, scale: 1, materialId: null, mount, colors: colorsFor };
    const lifted = elevate(ctx, acc, base);
    if (!lifted.ok) return false;
    const ok = validateObject(ctx, acc, lifted.value);
    if (ok.ok) acc = [...acc, ok.value];
    return ok.ok;
  };
  const g = brief.grandness;
  const stageE = entry('stage-wedding');
  const wantStage = brief.stage.present && Boolean(stageE);

  // ---- 1. stage and mandap (essential) ---------------------------------------------------------------------------
  if (wantStage && !place('stage-wedding', 'floor', z.stage.at.x, z.stage.at.z)) return { ok: false, error: 'The wedding stage does not fit in this venue.', hint: 'Choose a larger venue.' };
  if (!brief.stage.present) notes.push('Your inspiration shows no raised stage, so the mandap stands on the floor.');
  const onStage = wantStage ? ('stage' as const) : ('floor' as const);
  let mandapOk = true;
  if (brief.mandap.style !== 'none') {
    const mandapId = brief.mandap.style === 'modern' ? 'mandap-modern' : 'mandap-traditional';
    mandapOk = place(mandapId, onStage, z.mandap.x, z.mandap.z);
    if (!mandapOk) return { ok: false, error: 'The mandap does not fit in this venue.', hint: 'Choose a larger venue.' };
    if (brief.mandap.style !== brief.tradition && brief.tradition !== 'fusion') notes.push(`The mandap follows its own style (${brief.mandap.style}) while the overall style is ${brief.tradition}.`);
  } else notes.push('No mandap was requested.');

  // ---- 2. stage dressing -----------------------------------------------------------------------------------------
  if (brief.mandap.style !== 'none' && (brief.tradition !== 'modern' || has(brief, /lamp|diya/)) && (g >= 2 || has(brief, /lamp|diya/))) {
    for (const s of [-1, 1]) place('lamp-brass-stand', onStage, z.mandap.x + s * 2.9, z.mandap.z + (wantStage ? 0.6 : 1.0));
  }
  const wantFlowers = (u: string) => brief.flowers.some((f) => f.use === u);
  const stageArr = GRAND(g, [0, 2, 2, 4, 4]);
  for (let i = 0; i < stageArr; i++) place('flowers-centrepiece', onStage, z.mandap.x + (i % 2 ? 1 : -1) * (3.1 - Math.floor(i / 2) * 0.1), z.stage.maxZ - 0.5 - Math.floor(i / 2) * 0.7, 0, flowerOf('arrangements'));

  // ---- 3. entrance, aisle, ritual details ------------------------------------------------------------------------
  if (brief.entrance.treatment === 'floral_arch') place('arch-flower', 'floor', z.entrance.x, z.entrance.z - 0.2, 0, flowerOf('arch'));
  else if (brief.entrance.treatment === 'garland_curtain') for (const s of [-1, 1]) place('garland-marigold-curtain', 'wall', z.entrance.x + s * 2.4, z.room.maxZ, 0, flowerOf('garlands'));
  if (g >= 3 || wantFlowers('aisle') || brief.tradition === 'traditional') place('aisle-runner-floral', 'floor', z.centreX, z.aisle.minZ + 4, 0, flowerOf('aisle'));
  if (has(brief, /rangoli/)) place('rangoli-floor', 'floor', z.entrance.x, z.entrance.z - 1.6);
  if (has(brief, /swing|jhula/)) place('swing-jhula', 'floor', z.stage.minX - 2.2, z.stage.maxZ + 1.4);

  // Greenery and traditional props: potted palms frame the entrance, brass urns dress the stage, carved elephants guard a grand traditional entrance.
  if (g >= 2) for (const side of [-1, 1]) place('plant-potted', 'floor', z.entrance.x + side * 2.1, z.entrance.z - 0.6);
  if (g >= 4) for (const side of [-1, 1]) place('plant-potted', 'floor', side < 0 ? z.room.minX + 1.2 : z.room.maxX - 1.2, z.entrance.z - 4.5);
  if (g >= 3 && brief.mandap.style !== 'none') for (const side of [-1, 1]) place('urn-brass-flowers', onStage, z.mandap.x + side * 3.1, z.stage.minZ + 0.8, 0, flowerOf('arrangements'));
  if (g >= 4 && brief.tradition === 'traditional') for (const side of [-1, 1]) place('elephant-carved', 'floor', z.entrance.x + side * 3.4, z.entrance.z - 0.9, Math.PI);

  // ---- 4. floral and wall treatments -----------------------------------------------------------------------------
  const aisleArr = GRAND(g, [0, 2, 4, 6, 8]);
  const pattern = variant % 3;
  for (let i = 0; i < aisleArr; i++) {
    const side = i % 2 ? 1 : -1;
    const row = Math.floor(i / 2);
    const pos = pattern === 0 ? { x: z.centreX + side * (AISLE_HALF_WIDTH + 0.05), zz: z.aisle.minZ + 1.2 + row * 2.6 }
      : pattern === 1 ? { x: z.stage.at.x + side * (z.stage.maxX - z.stage.at.x + 1.0), zz: z.stage.maxZ + 0.8 + row * 1.0 }
      : { x: side < 0 ? z.room.minX + 1.6 : z.room.maxX - 1.6, zz: z.seating.left.minZ + 1 + row * 2.6 };
    place('flowers-centrepiece', 'floor', pos.x, pos.zz, 0, flowerOf('arrangements'));
  }
  const panels = wantFlowers('wall') || brief.tradition !== 'modern' ? GRAND(g, [0, 1, 2, 3, 3]) : GRAND(g, [0, 0, 1, 2, 2]);
  for (let i = 0; i < panels; i++) place('flowers-wall-panel', 'wall', i === 0 ? z.centreX : z.centreX + (i % 2 ? 1 : -1) * 3.2 * Math.ceil(i / 2), z.room.minZ, 0, flowerOf('wall'));
  if (wantFlowers('garlands') || brief.ceiling.treatment === 'floral' || brief.ceiling.treatment === 'draped') {
    const curtains = GRAND(g, [1, 2, 2, 3, 4]);
    for (let i = 0; i < curtains; i++) {
      if (!room.outdoor && (brief.ceiling.treatment === 'floral' || brief.ceiling.treatment === 'draped') && i % 2 === 0) place('garland-marigold-curtain', 'ceiling', z.centreX + (i - 1) * 2.4, z.ceiling.z, 0, flowerOf('canopy'));
      else place('garland-marigold-curtain', 'wall', i % 2 ? z.sideWalls.right.x : z.sideWalls.left.x, z.sideWalls.left.z + Math.floor(i / 2) * 3, 0, flowerOf('garlands'));
    }
  }

  // ---- 5. lighting -----------------------------------------------------------------------------------------------
  const feats = new Set(brief.lighting.features);
  if (brief.ceiling.treatment === 'chandeliers') feats.add('chandelier');
  if (brief.ceiling.treatment === 'fairy_lights') feats.add('fairy_lights');
  if (feats.has('chandelier')) {
    if (room.outdoor) { substitutions.push('This venue is open-air, so chandeliers are replaced by floor lanterns.'); feats.add('lanterns'); }
    else for (let i = 0; i < GRAND(g, [1, 1, 2, 3, 4]); i++) place('chandelier-crystal', 'ceiling', z.centreX, z.room.minZ + (i + 1) * (z.depth / (GRAND(g, [1, 1, 2, 3, 4]) + 1)));
  }
  if (feats.has('fairy_lights')) {
    for (let i = 0; i < GRAND(g, [1, 2, 2, 3, 4]); i++) place('lights-fairy-curtain', 'wall', i % 2 ? z.sideWalls.right.x : z.sideWalls.left.x, z.room.minZ + 2 + Math.floor(i / 2) * 4);
  }
  if (feats.has('lanterns') || feats.has('diyas')) {
    for (let i = 0; i < GRAND(g, [2, 4, 6, 8, 10]); i++) {
      const side = i % 2 ? 1 : -1;
      place('lantern-floor', 'floor', z.centreX + side * (AISLE_HALF_WIDTH + 0.45), z.aisle.minZ + 0.8 + Math.floor(i / 2) * 1.8);
    }
    if (feats.has('diyas')) substitutions.push('Diyas are shown as floor lanterns and brass lamps.');
  }
  if (brief.ceiling.treatment === 'draped') substitutions.push('There is no fabric ceiling drape model; garland curtains hang from the ceiling instead.');
  if (room.outdoor && (brief.ceiling.treatment === 'floral' || brief.ceiling.treatment === 'draped')) substitutions.push('This venue is open-air, so the ceiling treatment is shown as garland curtains on the boundary.');

  // ---- 6. seating ------------------------------------------------------------------------------------------------
  const cap = SEAT_CAP[Math.min(5, Math.max(1, g)) - 1]!;
  const seatsRequested = guests;
  const target = Math.min(cap, guests);
  let seats = 0;
  const arrangement = brief.seating.arrangement;
  const chairBlocks = (rects: Rect[], limit: number) => {
    const spots: { x: number; zz: number }[] = [];
    for (const r of rects) {
      const cols = Math.max(0, Math.floor(rectWidth(r) / 0.7));
      const rows = Math.max(0, Math.floor(rectDepth(r) / 0.85));
      for (let rr = 0; rr < rows; rr++) for (let c = 0; c < cols; c++) spots.push({ x: r.minX + 0.35 + c * 0.7, zz: r.minZ + 0.4 + rr * 0.85 });
    }
    // fill nearest the aisle and the stage first
    spots.sort((a, b) => a.zz - b.zz || Math.abs(a.x - z.centreX) - Math.abs(b.x - z.centreX));
    for (const s of spots) { if (seats >= limit) break; if (place('chair-banquet', 'floor', s.x, s.zz, Math.PI)) seats++; }
  };
  if (arrangement === 'banquet' || arrangement === 'mixed') {
    const tables = Math.min(arrangement === 'mixed' ? 3 : 8, Math.max(2, Math.ceil(target / 6 / 1.5)));
    const cols = 2, startZ = z.seating.left.minZ + 1.4;
    for (let t = 0; t < tables && seats < target; t++) {
      const side = t % cols === 0 ? -1 : 1;
      const tx = z.centreX + side * (AISLE_HALF_WIDTH + 2.4), tz = startZ + Math.floor(t / cols) * 3.6;
      if (!place('table-round-banquet', 'floor', tx, tz, 0, flowerOf('arrangements'))) continue;
      for (let k = 0; k < 6 && seats < target; k++) {
        const a = (k / 6) * Math.PI * 2;
        const cx = tx + Math.sin(a) * 1.25, cz = tz + Math.cos(a) * 1.25;
        if (place('chair-banquet', 'floor', cx, cz, Math.atan2(tx - cx, tz - cz))) seats++;
      }
    }
  }
  if (arrangement === 'theatre' || arrangement === 'mixed') chairBlocks([z.seating.left, z.seating.right], arrangement === 'mixed' ? Math.min(target, seats + 16) : target);
  if (arrangement === 'lounge') {
    for (let i = 0; i < Math.min(6, Math.ceil(target / 4)); i++) { const side = i % 2 ? 1 : -1; if (place('sofa-loveseat', 'floor', z.centreX + side * 4.2, z.seating.left.minZ + 1 + Math.floor(i / 2) * 2.2, Math.PI + side * 0.3)) seats += 2; }
    chairBlocks([z.seating.left, z.seating.right], Math.min(target, seats + 16));
  }
  if (seats < guests) notes.push(`${seats} chairs are shown as a representative layout; your wedding has ${guests} guests.`);

  // ---- budget ----------------------------------------------------------------------------------------------------
  const fullCost = sceneCost(acc);
  if (input.budgetInr !== null && fullCost > input.budgetInr) {
    const trim = suggestTrim(acc, input.budgetInr);
    if (!trim.feasible) return { ok: false, error: `Even the essentials (stage and mandap) cost about ₹${trim.resultingCost.toLocaleString('en-IN')} at sample prices, above your ₹${input.budgetInr.toLocaleString('en-IN')} budget.`, hint: 'Raise the decoration budget, or choose a design without a stage.' };
    const gone = new Set(trim.removeIds);
    const names = new Map<string, number>();
    for (const o of acc) if (gone.has(o.id)) names.set(entry(o.catalogId)?.name ?? o.catalogId, (names.get(entry(o.catalogId)?.name ?? o.catalogId) ?? 0) + 1);
    notes.push(`To stay within your budget I left out: ${[...names].map(([k, v]) => `${v} × ${k}`).join(', ')}.`);
    acc = acc.filter((o) => !gone.has(o.id));
    seats = acc.filter((o) => o.catalogId === 'chair-banquet').length;
  }

  const final = validateAll(ctx, acc);
  if (!final.ok) return { ok: false, error: 'The planned layout failed validation.', hint: 'Try another version or a larger venue.' };
  const cost = sceneCost(acc);
  const description = `${brief.title}: ${brief.summary} Built for ${room.name} with ${acc.length} pieces in ${palette.map((p) => p.name).join(', ')}.`;
  return { ok: true, plan: { objects: acc, costInr: cost, costLines: costLines(acc), palette, substitutions, notes, description, seatsRequested, seatsShown: seats, variant } };
}

import { describe, expect, it } from 'vitest';
import { CATEGORY_INFO, GARMENTS, GARMENT_CATEGORIES, GarmentSchema, findGarment, searchGarments } from './catalog.js';
import { applyWeddingAction } from '../actions.js';
import { createSampleWedding } from '../sample.js';

describe('try-on catalogue', () => {
  it('has valid illustrated garments in every category and no saree', () => {
    for (const g of GARMENTS) expect(GarmentSchema.safeParse(g).success).toBe(true);
    for (const c of GARMENT_CATEGORIES) expect(GARMENTS.some((g) => g.category === c)).toBe(true);
    expect(GARMENTS.some((g) => /sar[e|i]/i.test(g.id))).toBe(false);
  });
  it('only marks supported what the engine supports', () => {
    expect(CATEGORY_INFO.sherwani.status).toBe('future');
    expect(findGarment('sherwani-gold')!.supported).toBe(false);
    expect(searchGarments({ tryableOnly: true }).every((g) => g.supported)).toBe(true);
  });
  it('refuses to save a future-option look and saves a supported one', () => {
    const s = createSampleWedding('w');
    expect(applyWeddingAction(s, { type: 'save_outfit', outfit: { id: 'a', label: 'x', garmentId: 'sherwani-gold' } }).ok).toBe(false);
    expect(applyWeddingAction(s, { type: 'save_outfit', outfit: { id: 'a', label: 'x', garmentId: 'lehenga-ruby' } }).ok).toBe(true);
  });
});

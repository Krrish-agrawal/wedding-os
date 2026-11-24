import { describe, expect, it } from 'vitest';
import { createSampleWedding, type DesignVersion } from '@ave/shared';
import { acceptFiles, checkImageFile, MAX_FILE_BYTES } from './validation';
import { compareVersions, describeSource, errorMessage, stageLabel } from './helpers';

const f = (name: string, type: string, size = 1000) => ({ name, type, size });

describe('photo validation', () => {
  it('accepts JPEG, PNG, WebP and rejects other types, empty and oversized files', () => {
    for (const t of ['image/jpeg', 'image/png', 'image/webp']) expect(checkImageFile(f('a', t)).ok).toBe(true);
    for (const t of ['image/gif', 'application/pdf', 'image/svg+xml', '']) expect(checkImageFile(f('a', t)).ok).toBe(false);
    expect(checkImageFile(f('a', 'image/png', 0)).ok).toBe(false);
    const big = checkImageFile(f('big.png', 'image/png', MAX_FILE_BYTES + 1));
    expect(big.ok).toBe(false);
    expect(big.ok ? '' : big.reason).toMatch(/6 MB/);
  });
  it('respects the six-photo limit', () => {
    const files = Array.from({ length: 5 }, (_, i) => f(`p${i}.jpg`, 'image/jpeg'));
    const r = acceptFiles(files, 3);
    expect(r.accepted).toHaveLength(3);
    expect(r.rejected).toHaveLength(2);
    expect(acceptFiles([f('x.gif', 'image/gif')], 6).rejected[0]).toMatch(/JPEG, PNG or WebP/);
  });
});

describe('wording about photographs', () => {
  it('only claims analysis for a real vision design', () => {
    expect(describeSource('vision').analysedPhotos).toBe(true);
    for (const s of ['demo', 'manual', null] as const) {
      const d = describeSource(s);
      expect(d.analysedPhotos).toBe(false);
      expect(`${d.badge} ${d.line}`).not.toMatch(/(?<!NOT )analysed your photo/i);
    }
    expect(describeSource('demo').badge).toMatch(/SAMPLE/i);
    expect(describeSource('demo').line).toMatch(/NOT analysed/);
  });
  it('never claims the real venue was reconstructed', () => {
    for (const s of ['vision', 'demo', 'manual', null] as const) expect(describeSource(s).line).not.toMatch(/reconstruct|recreat/i);
  });
  it('demo stage labels never say photos are being analysed', () => {
    expect(stageLabel('analysing', 'demo')).not.toMatch(/photo/i);
    expect(stageLabel('analysing', 'vision')).toMatch(/photos/i);
  });
  it('has a message for each documented error code', () => {
    for (const c of ['rate_limited', 'quota', 'timeout', 'provider_down', 'refused', 'invalid_output', 'plan_failed']) expect(errorMessage(c)).not.toMatch(/could not be created/);
    expect(errorMessage('weird', 'server said')).toBe('server said');
  });
});

describe('version comparison', () => {
  it('computes differences from stored objects', () => {
    const s = createSampleWedding('w');
    const mk = (id: string, ids: string[], costInr: number): DesignVersion => ({ id, label: id, createdAt: '', source: 'demo', venueId: 'venue-grand-ballroom', objects: ids.map((catalogId, i) => ({ id: `o${i}`, catalogId, position: { x: 0, y: 0, z: 0 }, rotationY: 0, scale: 1, materialId: null, mount: 'floor' as const, colors: {} })), brief: null, summary: '', costInr, substitutions: [] });
    void s;
    const c = compareVersions(mk('a', ['chair-banquet', 'chair-banquet', 'stage-wedding'], 61200), mk('b', ['chair-banquet', 'stage-wedding', 'mandap-traditional', 'arch-flower'], 153600));
    expect(c.costDifferenceInr).toBe(92400);
    expect(c.pieceDifference).toBe(1);
    expect(c.categories.find((x) => x.category === 'seating')).toEqual({ category: 'seating', a: 2, b: 1 });
    expect(c.categories.find((x) => x.category === 'mandap')).toEqual({ category: 'mandap', a: 0, b: 1 });
  });
});

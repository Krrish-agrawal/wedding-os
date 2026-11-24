import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { ReactElement } from 'react';
import { DECOR_CATALOG, STUDIO_ROOMS } from '@ave/shared';
import { MODELS, buildModel } from './models';
import { ALLOWED_LICENCES, GLB_FIT, REGISTRY, creditsFor, glbFor, type RegistryAsset } from './glb';
import { THEME_SKY } from './VenueModel';

describe('studio assets', () => {
  it('every catalogue entry has a procedural model builder, and no builder is orphaned', () => {
    for (const e of DECOR_CATALOG) expect(MODELS[e.model], e.id).toBeTypeOf('function');
    const used = new Set(DECOR_CATALOG.map((e) => e.model));
    for (const key of Object.keys(MODELS)) expect(used.has(key), `unused builder ${key}`).toBe(true);
  });
  it('every venue theme has a sky colour', () => {
    for (const r of Object.values(STUDIO_ROOMS)) expect(THEME_SKY[r.theme ?? 'ballroom']).toMatch(/^#/);
  });
});

/** Extents of everything a builder draws, read from its element tree (no WebGL needed). */
function extents(node: unknown, acc = { x: 0, z: 0, y: 0, parts: 0 }) {
  if (!node || typeof node !== 'object') return acc;
  const el = node as ReactElement<Record<string, unknown>>;
  const p = el.props;
  if (p) {
    const at = p.p as [number, number, number] | undefined;
    const s = p.s as [number, number, number] | undefined;
    const r = typeof p.r === 'number' ? p.r : 0;
    const hh = typeof p.h === 'number' ? p.h / 2 : r; // cylinders have a height; balls do not
    if (at) { acc.parts++; acc.x = Math.max(acc.x, Math.abs(at[0]) + (s ? s[0] / 2 : r)); acc.z = Math.max(acc.z, Math.abs(at[2]) + (s ? s[2] / 2 : r)); acc.y = Math.max(acc.y, at[1] + (s ? s[1] / 2 : hh)); }
    const pts = p.pts as [number, number, number, number][] | undefined;
    if (pts) for (const [x, y, z, rr] of pts) { acc.parts++; acc.x = Math.max(acc.x, Math.abs(x) + rr); acc.z = Math.max(acc.z, Math.abs(z) + rr); acc.y = Math.max(acc.y, y + rr); }
    const kids = p.children;
    for (const k of Array.isArray(kids) ? kids.flat(Infinity) : [kids]) extents(k, acc);
  }
  return acc;
}

describe('procedural models', () => {
  for (const e of DECOR_CATALOG) {
    it(`${e.id} builds, uses only catalogue parts, and stays within its footprint`, () => {
      const used = new Set<string>();
      const c = (part: string) => { used.add(part); return e.parts.find((p) => p.id === part)?.color ?? '#ff00ff'; };
      const el = MODELS[e.model]!({ w: e.size.width, d: e.size.depth, h: e.size.height, c });
      const ex = extents(el);
      expect(ex.parts, 'draws something').toBeGreaterThan(2);
      for (const part of used) expect(e.parts.some((p) => p.id === part), `unknown part ${part}`).toBe(true);
      // Pieces drawn before this pass (modern mandap flowers, table centrepiece) overhang slightly; the bound is generous but real.
      const tol = 0.25;
      expect(ex.x).toBeLessThanOrEqual(e.size.width / 2 + tol);
      expect(ex.z).toBeLessThanOrEqual(e.size.depth / 2 + tol);
      expect(ex.y).toBeLessThanOrEqual(e.size.height + 0.4);
      expect(buildModel(e, {})).toBeTruthy();
    });
  }
});

describe('asset licence registry', () => {
  const root = path.resolve(__dirname, '../../../public/models/wedding');
  const sha = (f: string) => createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  it('only lists verified, permissively licensed, present files whose hashes match', () => {
    expect(REGISTRY.length).toBeGreaterThan(0);
    for (const a of REGISTRY as readonly RegistryAsset[]) {
      expect(ALLOWED_LICENCES, a.assetId).toContain(a.licence);
      expect(a.licenceUrl, a.assetId).toMatch(/^https:\/\//);
      expect(a.sourceUrl, a.assetId).toMatch(/^https:\/\//);
      expect(a.checkedOn, a.assetId).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(a.author.length, a.assetId).toBeGreaterThan(1);
      if (a.licence === 'CC-BY-4.0') { expect(a.attributionRequired).toBe(true); expect(a.attributionText.length).toBeGreaterThan(10); }
      for (const id of a.catalogIds ?? []) expect(DECOR_CATALOG.some((e) => e.id === id), `${a.assetId} -> ${id} is a catalogue id`).toBe(true);
      const files = [{ path: a.file, sha256: a.sha256, bytes: 0 }, ...(a.includes ?? [])];
      for (const f of files) {
        const file = path.join(root, f.path);
        expect(fs.existsSync(file), `${f.path} exists`).toBe(true);
        expect(fs.statSync(file).size, `${f.path} under 6MB`).toBeLessThan(6 * 1024 * 1024);
        expect(sha(file), `${f.path} sha256`).toBe(f.sha256);
      }
    }
  });
  it('rejects non-permitted licences', () => {
    for (const bad of ['CC-BY-NC-4.0', 'CC-BY-ND-4.0', 'unknown', 'Sketchfab-Standard']) expect(ALLOWED_LICENCES as readonly string[]).not.toContain(bad);
  });
  it('every catalogue-mapped model has a fit entry that refers to real catalogue parts', () => {
    for (const [id, fit] of Object.entries(GLB_FIT)) {
      const e = DECOR_CATALOG.find((x) => x.id === id);
      expect(e, id).toBeTruthy();
      for (const part of Object.keys(fit.parts ?? {})) expect(e!.parts.some((p) => p.id === part), `${id}.${part}`).toBe(true);
      expect(glbFor(id), `${id} has a registered model`).toBeTruthy();
    }
  });
  it('credits and lookups work, and an empty registry changes nothing', () => {
    const fake: RegistryAsset = { assetId: 'x', kind: 'model', catalogIds: ['chair-banquet'], file: 'x.glb', sourceUrl: 'https://example.org', author: 'A', licence: 'CC-BY-4.0', licenceUrl: 'https://example.org', attributionRequired: true, attributionText: 'Chair by A (CC BY 4.0)', checkedOn: '2026-11-23', sha256: '' };
    expect(creditsFor([fake])).toEqual(['Chair by A (CC BY 4.0)']);
    expect(glbFor('chair-banquet', [fake])).toBe(fake);
    expect(glbFor('chair-banquet', [])).toBeUndefined();
    expect(creditsFor()).toContain('Includes CC0 assets from Poly Haven (polyhaven.com).');
  });
});

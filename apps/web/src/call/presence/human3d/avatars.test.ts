import { describe, expect, it } from 'vitest';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { DEFAULT_AVATAR_SOURCES, avatarSources, detectBody, hasQuantisedSkin, incompatibility } from './avatars';
import { scaleBodyRotation } from './staging';

/** Just enough of a loaded glTF scene for the checks: named nodes, morph target names, skinned meshes. */
function fakeGltf(nodes: Array<{ name: string; shapes?: string[]; skinnedNormalized?: boolean }>): GLTF {
  const objects = nodes.map((n) => ({
    name: n.name,
    morphTargetDictionary: n.shapes ? Object.fromEntries(n.shapes.map((s, i) => [s, i])) : undefined,
    isSkinnedMesh: n.skinnedNormalized !== undefined,
    geometry: { attributes: { position: { normalized: n.skinnedNormalized ?? false } } },
  }));
  return { scene: { traverse: (fn: (o: unknown) => void) => objects.forEach(fn) } } as unknown as GLTF;
}

const VISEMES = ['aa', 'E', 'I', 'O', 'U', 'PP', 'SS', 'TH', 'DD', 'FF', 'kk', 'nn', 'RR', 'CH'].map((v) => `viseme_${v}`);

describe('avatar sources', () => {
  it('prefers the Avaturn advisor, optimised first, then the MPFB stand-in', () => {
    expect(avatarSources().map((s) => s.url)).toEqual([
      '/avatar/advisor.opt.glb',
      '/avatar/advisor.glb',
      '/avatar/mpfb.opt.glb',
      '/avatar/mpfb.glb',
    ]);
    expect(DEFAULT_AVATAR_SOURCES.map((s) => s.kind)).toEqual(['avaturn', 'avaturn', 'mpfb', 'mpfb']);
  });
});

describe('detectBody', () => {
  it('reads explicit extras first', () => {
    expect(detectBody({ asset: { extras: { gender: 'male' } }, meshes: [{ name: 'young_female_body' }] })).toBe('M');
    expect(detectBody({ extras: { body: 'F' } })).toBe('F');
  });

  it('reads female / male from names without mistaking "female" for "male"', () => {
    expect(detectBody({ images: [{ name: 'young_lightskinned_female_diffuse2' }] })).toBe('F');
    expect(detectBody({ materials: [{ name: 'male_casualsuit03' }] })).toBe('M');
  });

  it('says nothing when the file does not say, or says both', () => {
    expect(detectBody({ meshes: [{ name: 'avaturn_body' }], extras: { created_by: 'Avaturn.me' } })).toBeNull();
    expect(detectBody({ meshes: [{ name: 'female_top' }, { name: 'male_shoes' }] })).toBeNull();
    expect(detectBody(null)).toBeNull();
  });
});

describe('incompatibility', () => {
  it('rejects a static-face export (no blend shapes, no eyes), like an Avaturn Type-1 avatar', () => {
    expect(incompatibility(fakeGltf([{ name: 'Hips' }, { name: 'Head' }, { name: 'avaturn_body', shapes: [] }]))).toMatch(/static-face/);
  });

  it('rejects missing visemes and missing eye bones', () => {
    expect(incompatibility(fakeGltf([{ name: 'body', shapes: VISEMES.slice(2) }, { name: 'LeftEye' }, { name: 'RightEye' }]))).toMatch(/viseme_aa/);
    expect(incompatibility(fakeGltf([{ name: 'body', shapes: VISEMES }, { name: 'LeftEye' }]))).toMatch(/RightEye/);
  });

  it('accepts visemes plus eye bones, with or without the mixamorig prefix and viseme_sil', () => {
    expect(incompatibility(fakeGltf([{ name: 'body', shapes: VISEMES }, { name: 'mixamorigLeftEye' }, { name: 'mixamorig:RightEye' }]))).toBeNull();
  });
});

describe('hasQuantisedSkin', () => {
  it('spots quantised skinned positions, which TalkingHead cannot retarget', () => {
    expect(hasQuantisedSkin(fakeGltf([{ name: 'body', skinnedNormalized: true }]))).toBe(true);
    expect(hasQuantisedSkin(fakeGltf([{ name: 'body', skinnedNormalized: false }, { name: 'Hips' }]))).toBe(false);
  });
});

describe('scaleBodyRotation', () => {
  const template = {
    name: 'head',
    idle: { delay: [0, 1000], dt: [[200, 5000]], vs: { bodyRotateX: [[-0.04, 0.1]], bodyRotateY: [[-0.3, 0.3]], eyeBlinkLeft: [[0, 1]] } },
    speaking: { dt: [[0, 1000, 0]], vs: { bodyRotateZ: [[-0.1, 0.1, 1, 2]] } },
    alt: [{ p: 0.5, vs: { bodyRotateY: [0.2] } }],
  };

  it('scales body turns only, keeping timing, skew and other shapes', () => {
    const out = scaleBodyRotation(template, 0.5);
    expect(out.idle.vs.bodyRotateY).toEqual([[-0.15, 0.15]]);
    expect(out.idle.vs.bodyRotateX[0]?.[0]).toBeCloseTo(-0.02);
    expect(out.speaking.vs.bodyRotateZ).toEqual([[-0.05, 0.05, 1, 2]]);
    expect(out.alt[0]?.vs.bodyRotateY).toEqual([0.1]);
    expect(out.idle.vs.eyeBlinkLeft).toEqual([[0, 1]]);
    expect(out.idle.dt).toEqual([[200, 5000]]);
    expect(template.idle.vs.bodyRotateY).toEqual([[-0.3, 0.3]]);
  });
});

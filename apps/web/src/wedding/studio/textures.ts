import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';

/**
 * Small generated textures (no files, no licences): woven fabric, gold-thread brocade and a petal scatter. They are drawn in
 * greyscale-ish light tones and used as a `map` on a material whose `color` is the catalogue colour part, so the colour
 * multiplies the texture and recolouring still works exactly as before.
 */
export type TexKind = 'fabric' | 'brocade' | 'petals';
const cache = new Map<TexKind, CanvasTexture>();

function rng(seed: number) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

function draw(kind: TexKind): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e9e9e9';
  g.fillRect(0, 0, 256, 256);
  const r = rng(kind === 'fabric' ? 7 : kind === 'brocade' ? 11 : 13);
  if (kind === 'fabric') {
    for (let y = 0; y < 256; y += 4) { g.fillStyle = `rgba(0,0,0,${0.05 + r() * 0.08})`; g.fillRect(0, y, 256, 2); }
    for (let x = 0; x < 256; x += 4) { g.fillStyle = `rgba(255,255,255,${0.1 + r() * 0.1})`; g.fillRect(x, 0, 2, 256); }
  } else if (kind === 'brocade') {
    g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(70,50,10,0.38)'; g.lineWidth = 3;
    for (let gy = 0; gy < 4; gy++) for (let gx = 0; gx < 4; gx++) {
      const cx = gx * 64 + 32, cy = gy * 64 + 32;
      g.beginPath(); g.moveTo(cx, cy - 22); g.quadraticCurveTo(cx + 22, cy, cx, cy + 22); g.quadraticCurveTo(cx - 22, cy, cx, cy - 22); g.stroke();
      g.beginPath(); g.arc(cx, cy, 5, 0, Math.PI * 2); g.fillStyle = 'rgba(70,50,10,0.35)'; g.fill();
      g.beginPath(); g.moveTo(cx + 32, cy - 8); g.lineTo(cx + 32, cy + 8); g.stroke();
    }
    for (let y = 0; y < 256; y += 3) { g.fillStyle = 'rgba(0,0,0,0.05)'; g.fillRect(0, y, 256, 1); }
  } else {
    for (let i = 0; i < 160; i++) {
      const x = r() * 256, y = r() * 256, a = r() * Math.PI, s = 6 + r() * 9, l = 150 + Math.floor(r() * 100);
      g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = `rgb(${l},${l},${l})`; g.beginPath(); g.ellipse(0, 0, s, s * 0.55, 0, 0, Math.PI * 2); g.fill(); g.restore();
    }
  }
  return c;
}

export function texture(kind: TexKind, repeat = 4): CanvasTexture {
  let t = cache.get(kind);
  if (!t) {
    t = new CanvasTexture(draw(kind));
    t.wrapS = t.wrapT = RepeatWrapping;
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 4;
    cache.set(kind, t);
  }
  t.repeat.set(repeat, repeat);
  return t;
}

/** Which texture suits which catalogue colour part. */
export const PART_TEXTURE: Record<string, TexKind> = { canopy: 'brocade', drapes: 'fabric', carpet: 'fabric', fabric: 'fabric', runner: 'petals', cloth: 'fabric' };

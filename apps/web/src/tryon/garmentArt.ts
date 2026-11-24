import { ART_SIZE, type Garment } from '@ave/shared';

/**
 * Original procedural flat-lay artwork for every garment: our own drawing, never a photo. Drawn on a transparent
 * 600x900 canvas whose shoulder/waist/hem positions match `garment.anchors` in the shared catalogue.
 */

type Ctx = CanvasRenderingContext2D;
const poly = (c: Ctx, pts: [number, number][], fill: string) => { c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); c.fillStyle = fill; c.fill(); };

function skirt(c: Ctx, g: Garment, top: number) {
  const { waistL, waistR, hemL, hemR } = g.anchors;
  const { primary, secondary, trim } = g.art;
  c.beginPath();
  c.moveTo(waistL[0], top);
  c.bezierCurveTo(waistL[0] - 30, (top + hemL[1]) / 2, hemL[0] + 10, hemL[1] - 120, hemL[0], hemL[1] - 12);
  c.quadraticCurveTo((hemL[0] + hemR[0]) / 2, hemL[1] + 28, hemR[0], hemR[1] - 12);
  c.bezierCurveTo(hemR[0] - 10, hemR[1] - 120, waistR[0] + 30, (top + hemR[1]) / 2, waistR[0], top);
  c.closePath();
  const grad = c.createLinearGradient(0, top, 0, hemL[1]);
  grad.addColorStop(0, secondary); grad.addColorStop(1, primary);
  c.fillStyle = grad; c.fill();
  // Pleat lines and a gold border.
  c.strokeStyle = 'rgba(0,0,0,0.10)'; c.lineWidth = 2;
  for (let i = 1; i < 9; i++) { const t = i / 9; c.beginPath(); c.moveTo(waistL[0] + (waistR[0] - waistL[0]) * t, top); c.lineTo(hemL[0] + (hemR[0] - hemL[0]) * t, hemL[1] - 8); c.stroke(); }
  c.strokeStyle = trim; c.lineWidth = 14;
  c.beginPath(); c.moveTo(hemL[0] + 6, hemL[1] - 26); c.quadraticCurveTo((hemL[0] + hemR[0]) / 2, hemL[1] + 14, hemR[0] - 6, hemR[1] - 26); c.stroke();
}

function bodice(c: Ctx, g: Garment, opts: { sleeves: boolean; neck: number; bottom: number }) {
  const { shoulderL, shoulderR, waistL, waistR } = g.anchors;
  const fill = g.art.primary;
  if (opts.sleeves) {
    poly(c, [[shoulderL[0] - 8, shoulderL[1]], [shoulderL[0] - 62, shoulderL[1] + 150], [shoulderL[0] - 8, shoulderL[1] + 165], [shoulderL[0] + 16, shoulderL[1] + 40]], fill);
    poly(c, [[shoulderR[0] + 8, shoulderR[1]], [shoulderR[0] + 62, shoulderR[1] + 150], [shoulderR[0] + 8, shoulderR[1] + 165], [shoulderR[0] - 16, shoulderR[1] + 40]], fill);
  }
  c.beginPath();
  c.moveTo(shoulderL[0], shoulderL[1]); c.lineTo(300 - opts.neck, shoulderL[1]);
  c.quadraticCurveTo(300, shoulderL[1] + opts.neck * 1.6, 300 + opts.neck, shoulderR[1]); c.lineTo(shoulderR[0], shoulderR[1]);
  c.lineTo(waistR[0] + 6, opts.bottom); c.lineTo(waistL[0] - 6, opts.bottom); c.closePath();
  c.fillStyle = fill; c.fill();
  c.strokeStyle = g.art.trim; c.lineWidth = 6; c.stroke();
}

/** Draws the garment into a new canvas. Browser only. */
export function drawGarment(g: Garment): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = ART_SIZE.width; canvas.height = ART_SIZE.height;
  const c = canvas.getContext('2d')!;
  const { shoulderL, shoulderR, waistL, waistR, hemL, hemR } = g.anchors;
  const { primary, secondary, trim } = g.art;
  switch (g.art.kind) {
    case 'lehenga':
      skirt(c, g, waistL[1] - 6);
      bodice(c, g, { sleeves: true, neck: 36, bottom: waistL[1] + 4 });
      c.fillStyle = trim; c.fillRect(waistL[0] - 8, waistL[1] - 10, waistR[0] - waistL[0] + 16, 14); // waistband
      break;
    case 'gown':
      skirt(c, g, waistL[1] - 6);
      bodice(c, g, { sleeves: false, neck: 46, bottom: waistL[1] + 4 });
      break;
    case 'anarkali': {
      skirt(c, g, waistL[1] - 6);
      bodice(c, g, { sleeves: true, neck: 30, bottom: waistL[1] + 4 });
      c.strokeStyle = trim; c.lineWidth = 8; c.beginPath(); c.moveTo(waistL[0] - 6, waistL[1]); c.lineTo(waistR[0] + 6, waistL[1]); c.stroke();
      break;
    }
    case 'kurta': case 'sherwani': case 'coat': {
      const long = g.art.kind !== 'kurta';
      const sl = 62;
      poly(c, [[shoulderL[0] - 6, shoulderL[1]], [shoulderL[0] - sl, shoulderL[1] + (long ? 280 : 150)], [shoulderL[0] - 8, shoulderL[1] + (long ? 295 : 165)], [shoulderL[0] + 16, shoulderL[1] + 40]], secondary);
      poly(c, [[shoulderR[0] + 6, shoulderR[1]], [shoulderR[0] + sl, shoulderR[1] + (long ? 280 : 150)], [shoulderR[0] + 8, shoulderR[1] + (long ? 295 : 165)], [shoulderR[0] - 16, shoulderR[1] + 40]], secondary);
      c.beginPath(); c.moveTo(shoulderL[0], shoulderL[1]); c.lineTo(285, shoulderL[1]); c.lineTo(300, shoulderL[1] + 28); c.lineTo(315, shoulderL[1]); c.lineTo(shoulderR[0], shoulderR[1]);
      c.lineTo(hemR[0], hemR[1]); c.lineTo(hemL[0], hemL[1]); c.closePath();
      const gr = c.createLinearGradient(0, 70, 0, hemL[1]); gr.addColorStop(0, primary); gr.addColorStop(1, secondary);
      c.fillStyle = gr; c.fill();
      c.strokeStyle = trim; c.lineWidth = 8; c.beginPath(); c.moveTo(300, shoulderL[1] + 28); c.lineTo(300, hemL[1] - 4); c.stroke();
      c.fillStyle = trim; for (let y = shoulderL[1] + 80; y < hemL[1] - 20; y += 70) { c.beginPath(); c.arc(300, y, 7, 0, Math.PI * 2); c.fill(); }
      break;
    }
  }
  // Watermark so the drawing can never be mistaken for a product photo.
  c.fillStyle = 'rgba(0,0,0,0.35)'; c.font = '600 20px sans-serif'; c.textAlign = 'center';
  c.fillText('illustration', 300, 895 - (g.art.kind === 'kurta' ? 220 : 4) );
  return canvas;
}

const thumbs = new Map<string, string>();
/** A small data URL of the artwork, for catalogue cards. Cached. */
export function garmentThumb(g: Garment): string {
  let t = thumbs.get(g.id);
  if (!t) {
    const full = drawGarment(g);
    const s = document.createElement('canvas'); s.width = 150; s.height = 225;
    s.getContext('2d')!.drawImage(full, 0, 0, 150, 225);
    thumbs.set(g.id, (t = s.toDataURL('image/png')));
  }
  return t;
}

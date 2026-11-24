/**
 * Capability smoke test for the vision model behind AI design.
 *
 *   pnpm --filter @ave/server wedding:design-smoke
 *
 * Makes ONE real call with a small generated PNG (a warm gradient, not a wedding photograph) and checks that the configured
 * WEDDING_VISION_MODEL accepts image input, honours the strict JSON schema, and returns a brief that passes validation.
 * It proves capability only, not design quality. Exit codes: 0 passed, 1 failed, 2 not run (no OPENAI_API_KEY or
 * WEDDING_VISION_MODEL). A report is written to apps/server/var/design-smoke-<time>.json; `live` is true only when a real
 * provider call was actually made. No keys or image data are written.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { openAiChat } from '../agent/sim.js';
import { VAR_DIR, loadConfig } from '../config.js';
import { DesignError, analyseInspiration } from '../wedding/design/vision.js';
import { redactSecrets } from '../wedding/planner.js';

const config = loadConfig();
const model = config.WEDDING_VISION_MODEL;
const create = openAiChat(config);
if (!create || !model) {
  console.log(`DESIGN SMOKE NOT RUN: ${!create ? 'OPENAI_API_KEY' : 'WEDDING_VISION_MODEL'} is not set on the server (.env or shell).\nNothing was sent to any provider.`);
  process.exit(2);
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function gradientPng(w = 96, h = 96): Buffer {
  const rows: Buffer[] = [];
  for (let y = 0; y < h; y++) { const row = Buffer.alloc(1 + w * 3); for (let x = 0; x < w; x++) { row[1 + x * 3] = 200 + (x * 55) / w; row[2 + x * 3] = 120 + (y * 100) / h; row[3 + x * 3] = 40 + (x * 40) / w; } rows.push(row); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

const started = Date.now();
let report: Record<string, unknown>;
let exit = 0;
try {
  const r = await analyseInspiration({
    create, model, images: [`data:image/png;base64,${gradientPng().toString('base64')}`], venueName: 'Sample Grand Ballroom', timeoutMs: config.WEDDING_VISION_TIMEOUT_MS,
    form: { description: 'Warm marigold and maroon South Indian wedding', style: 'Traditional South Indian', guestCount: 150, decorationBudgetInr: null, palette: ['marigold', 'maroon'] },
  });
  report = { live: true, passed: true, model, latencyMs: Date.now() - started, usage: r.usage, briefTitle: r.brief.title, note: 'Capability check only (image accepted, strict schema honoured, brief valid). The test image is a gradient, not a wedding photograph; this says nothing about design quality.' };
  console.log(`PASSED (live): ${model} accepted an image and returned a valid brief in ${Date.now() - started} ms (${r.usage.calls} call(s), ${r.usage.promptTokens}+${r.usage.completionTokens} tokens).`);
} catch (err) {
  exit = 1;
  const code = err instanceof DesignError ? err.code : 'unknown';
  // `live` is true: a provider call was attempted. The message is the safe mapped one, never provider text.
  report = { live: true, passed: false, model, latencyMs: Date.now() - started, errorCode: code, error: redactSecrets(err instanceof Error ? err.message : String(err)) };
  console.log(`FAILED (live call made): ${code}: ${(report.error as string)}`);
}
fs.mkdirSync(VAR_DIR, { recursive: true });
const file = path.join(VAR_DIR, `design-smoke-${Date.now()}.json`);
fs.writeFileSync(file, JSON.stringify(report, null, 2));
console.log(`Report: ${file}`);
process.exit(exit);

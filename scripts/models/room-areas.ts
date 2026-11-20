/**
 * Recomputes every room's `areaSqft` from its polygon (shoelace formula, 1 m² = 10.7639 sq ft)
 * and prints per-level totals. Writes the file back only with --write.
 *
 *   tsx scripts/models/room-areas.ts <property-id> [--write]
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { RoomsFileSchema, polygonAreaM2 } from '@ave/shared';

const SQFT_PER_M2 = 10.7639;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const { positionals, values } = parseArgs({ allowPositionals: true, options: { write: { type: 'boolean', default: false } } });
const id = positionals[0];
if (!id) {
  console.error('usage: tsx scripts/models/room-areas.ts <property-id> [--write]');
  process.exit(1);
}
const file = path.join(ROOT, 'data/properties', id, 'rooms.json');
const parsed = RoomsFileSchema.parse(JSON.parse(await readFile(file, 'utf8')));
const totals = new Map<number, { m2: number; seats: number }>();
for (const room of parsed.rooms) {
  const m2 = polygonAreaM2(room.polygon);
  room.areaSqft = Math.round(m2 * SQFT_PER_M2);
  const level = room.level ?? 0;
  const t = totals.get(level) ?? { m2: 0, seats: 0 };
  t.m2 += m2;
  t.seats += room.seats ?? 0;
  totals.set(level, t);
  console.log(`${room.id.padEnd(16)} level ${level}  ${m2.toFixed(2).padStart(7)} m²  ${String(room.areaSqft).padStart(5)} sq ft${room.seats !== undefined ? `  seats ${room.seats}` : ''}`);
}
let all = 0;
for (const [level, t] of [...totals].sort((a, b) => a[0] - b[0])) {
  all += t.m2;
  console.log(`level ${level}: ${t.m2.toFixed(1)} m² = ${Math.round(t.m2 * SQFT_PER_M2)} sq ft, ${t.seats} desk seats`);
}
console.log(`total: ${all.toFixed(1)} m² = ${Math.round(all * SQFT_PER_M2)} sq ft`);
if (values.write) {
  await writeFile(file, `${JSON.stringify(parsed, null, 2)}\n`);
  console.log(`wrote ${path.relative(ROOT, file)}`);
}

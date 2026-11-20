import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildContent, type Content } from '@ave/shared';
import { DATA_DIR } from './config.js';

/** Reads every JSON file under /data and validates it into Content. */
export async function loadContent(dataDir = DATA_DIR): Promise<Content> {
  const files: Record<string, unknown> = {};
  for (const abs of await walk(dataDir)) {
    if (!abs.endsWith('.json')) continue;
    const rel = path.relative(dataDir, abs).split(path.sep).join('/');
    try {
      files[rel] = JSON.parse(await readFile(abs, 'utf8'));
    } catch (err) {
      throw new Error(`${rel}: not valid JSON (${(err as Error).message})`);
    }
  }
  return buildContent(files);
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

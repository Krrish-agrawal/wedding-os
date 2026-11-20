/**
 * Shared helpers for the map data scripts: paths, polite HTTP with caching, and JSON files.
 * These scripts call free public services (Overpass, OSRM). Keep traffic low:
 * one request at a time, spaced out, cached to disk so reruns cost nothing.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PropertySchema, type Property } from '@ave/shared';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(here, '../..');
export const DATA_DIR = path.join(ROOT_DIR, 'data');
/** Raw API responses, so reruns and reviews do not hit the services again. */
export const CACHE_DIR = path.join(here, '.cache');

/** Identifies this tool to the services. No personal data. */
export const USER_AGENT = process.env.MAPS_DATA_USER_AGENT ?? 'AgoraVirtualEstates-data/0.1 (maps data research)';

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function readJson<T = unknown>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T;
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function readCache<T>(name: string): Promise<T | null> {
  try {
    return await readJson<T>(path.join(CACHE_DIR, name));
  } catch {
    return null;
  }
}

export async function writeCache(name: string, value: unknown): Promise<void> {
  await writeJson(path.join(CACHE_DIR, name), value);
}

/** Every property under data/properties, validated. */
export async function loadProperties(): Promise<Property[]> {
  const dir = path.join(DATA_DIR, 'properties');
  const ids = (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  const out: Property[] = [];
  for (const id of ids) {
    out.push(PropertySchema.parse(await readJson(path.join(dir, id, 'property.json'))));
  }
  return out;
}

interface PoliteFetchOptions {
  /** Attempts before giving up, including the first. */
  attempts?: number;
  /** First back-off wait; doubles each retry. */
  backoffMs?: number;
}

const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const DEFAULT_ATTEMPTS = 5;
const DEFAULT_BACKOFF_MS = 5_000;
/** Longer than Overpass's declared query timeout, so a slow answer is not cut short. */
const REQUEST_TIMEOUT_MS = 120_000;

/**
 * Fetches JSON with an identifying User-Agent, retrying with exponential back-off when the
 * service says it is busy or the connection fails. Throws after the last attempt so the script stops loudly.
 */
export async function politeFetchJson<T>(url: string, init: RequestInit = {}, opts: PoliteFetchOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? DEFAULT_ATTEMPTS;
  let wait = opts.backoffMs ?? DEFAULT_BACKOFF_MS;
  let lastError = '';
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let res: Response | null = null;
    let text = '';
    try {
      res = await fetch(url, { ...init, headers: { 'User-Agent': USER_AGENT, ...init.headers }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      text = await res.text();
    } catch (err) {
      lastError = `network: ${(err as Error).message}`;
    }
    if (res?.ok) {
      try {
        return JSON.parse(text) as T;
      } catch {
        lastError = `not JSON: ${text.slice(0, 120)}`;
      }
    } else if (res) {
      lastError = `HTTP ${res.status}: ${text.slice(0, 120)}`;
      if (!RETRYABLE_STATUS.has(res.status)) break;
    }
    if (attempt < attempts) {
      console.warn(`  busy (${lastError.split('\n')[0]}); retrying in ${Math.round(wait / 1000)} s`);
      await sleep(wait);
      wait *= 2;
    }
  }
  throw new Error(`${url}: ${lastError}`);
}

/** "Sri Rama Temple Street" -> "sri-rama-temple-street" */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

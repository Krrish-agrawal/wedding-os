import { createReadStream, existsSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import type { FastifyPluginAsync } from 'fastify';
import type { PropertyBundle } from '@ave/shared';
import { ROOT_DIR, type Config } from '../config.js';

/**
 * Property photos on a public URL. WhatsApp providers (Twilio, Meta) fetch a message's image
 * themselves, so it must be reachable at `${PUBLIC_BASE_URL}/media/...` through the tunnel, which
 * points at this server rather than the web app. Read-only, images only, and never outside the
 * web app's public media folder.
 */

/** URL prefix, the same one the web app serves its public media under. */
export const MEDIA_URL_PREFIX = '/media/';
/** The web app's public media folder: the single source of property images. */
export const MEDIA_DIR = path.join(ROOT_DIR, 'apps/web/public/media');
/** Photos change only when content is rebuilt; let providers and browsers cache them for a while. */
const MEDIA_CACHE_SECONDS = 3600;

export const MEDIA_TYPES: Readonly<Record<string, string>> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

/**
 * WhatsApp delivers JPEG and PNG images; WebP is accepted only as a sticker. When a JPEG copy sits
 * next to a WebP image (same name), messages use the copy.
 */
const WHATSAPP_FALLBACK_EXT = '.jpg';
const WHATSAPP_UNSUPPORTED_EXT = '.webp';

/**
 * The file a media path names, or null when the path is unsafe, not an image, or missing.
 * `relPath` is the part after /media/.
 */
export function resolveMediaFile(root: string, relPath: string): string | null {
  if (!relPath || relPath.includes('\0') || relPath.includes('\\')) return null;
  const segments = relPath.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..' || s.startsWith('.'))) return null;
  if (!MEDIA_TYPES[path.extname(relPath).toLowerCase()]) return null;
  let realRoot: string;
  let real: string;
  try {
    realRoot = realpathSync(root);
    real = realpathSync(path.resolve(root, ...segments));
  } catch {
    return null;
  }
  // A symlink must not lead out of the media folder.
  if (!real.startsWith(realRoot + path.sep)) return null;
  try {
    return statSync(real).isFile() ? real : null;
  } catch {
    return null;
  }
}

export interface PropertyMedia {
  /** What the image shows, e.g. "Photo" or "Floor plan (Mezzanine)". */
  label: string;
  /** Path the web app uses, e.g. /media/apt-indiranagar/hero.webp. */
  path: string;
  /** Public URL a WhatsApp provider can fetch, or null when PUBLIC_BASE_URL is not set. */
  url: string | null;
}

/** The public path to send on WhatsApp for an image: its JPEG copy when the original is WebP and one exists. */
export function whatsAppMediaPath(publicPath: string, root = MEDIA_DIR): string {
  if (path.extname(publicPath).toLowerCase() !== WHATSAPP_UNSUPPORTED_EXT || !publicPath.startsWith(MEDIA_URL_PREFIX)) return publicPath;
  const jpeg = publicPath.slice(0, -WHATSAPP_UNSUPPORTED_EXT.length) + WHATSAPP_FALLBACK_EXT;
  return existsSync(path.join(root, jpeg.slice(MEDIA_URL_PREFIX.length))) ? jpeg : publicPath;
}

/** `${PUBLIC_BASE_URL}${path}`, or null without a public base. */
export function publicMediaUrl(config: Pick<Config, 'PUBLIC_BASE_URL'>, publicPath: string): string | null {
  const base = config.PUBLIC_BASE_URL?.replace(/\/+$/, '');
  return base ? `${base}${publicPath}` : null;
}

/** The images of one property that can be sent on WhatsApp: the hero photo and each floor plan. */
export function propertyMedia(config: Pick<Config, 'PUBLIC_BASE_URL'>, bundle: PropertyBundle, root = MEDIA_DIR): PropertyMedia[] {
  const p = bundle.property;
  const plans = p.levels?.length
    ? p.levels.map((l) => ({ label: p.levels!.length > 1 ? `Floor plan (${l.name})` : 'Floor plan', path: l.planImage }))
    : [{ label: 'Floor plan', path: p.planImage }];
  const out: PropertyMedia[] = [];
  for (const m of [{ label: 'Photo', path: p.heroImage }, ...plans]) {
    if (!m.path.startsWith(MEDIA_URL_PREFIX) || out.some((o) => o.path === m.path)) continue;
    out.push({ label: m.label, path: m.path, url: publicMediaUrl(config, whatsAppMediaPath(m.path, root)) });
  }
  return out;
}

/** Why property photos cannot go out on WhatsApp right now, or null when they can. */
export function mediaUnavailableReason(config: Pick<Config, 'PUBLIC_BASE_URL'>): string | null {
  return config.PUBLIC_BASE_URL ? null : 'Photos need PUBLIC_BASE_URL (the tunnel) so WhatsApp can fetch them.';
}

export const mediaRoutes: FastifyPluginAsync<{ root?: string }> = async (app, opts) => {
  const root = opts.root ?? MEDIA_DIR;

  app.get<{ Params: { '*': string } }>(`${MEDIA_URL_PREFIX}*`, async (req, reply) => {
    const file = resolveMediaFile(root, req.params['*']);
    if (!file) return reply.code(404).send({ error: 'Not found' });
    return reply
      .header('content-type', MEDIA_TYPES[path.extname(file).toLowerCase()]!)
      .header('cache-control', `public, max-age=${MEDIA_CACHE_SECONDS}`)
      .header('x-content-type-options', 'nosniff')
      .send(createReadStream(file));
  });

  /** The sendable images of a property, with their public URLs, for the Desk's quick actions. */
  app.get<{ Params: { propertyId: string } }>('/api/media/properties/:propertyId', async (req, reply) => {
    const bundle = app.ctx.content.byId[req.params.propertyId];
    if (!bundle) return reply.code(404).send({ error: 'Property not found' });
    return { items: propertyMedia(app.ctx.config, bundle, root), unavailable: mediaUnavailableReason(app.ctx.config) };
  });
};

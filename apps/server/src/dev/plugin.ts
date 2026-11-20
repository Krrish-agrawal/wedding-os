import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import { buildContent, ContentError, PlanFileSchema, RoomsFileSchema, TourFileSchema } from '@ave/shared';
import { DATA_DIR, ROOT_DIR } from '../config.js';
import { loadContent } from '../content.js';

/**
 * Dev-only authoring endpoints used by the /studio 3D tools (shot capture, plan and hero renders).
 *
 * Refuses to run when NODE_ENV is "production". Writes only to an explicit allow-list:
 *   data/properties/<id>/rooms.json      (whole file, validated against RoomsFileSchema)
 *   data/properties/<id>/tour.json       (whole file, validated against TourFileSchema)
 *   data/properties/<id>/plan.json       (`bounds` alone, or `electrical` and `plumbing` together;
 *                                         the rest of the file is kept as is)
 *   apps/web/public/media/<id>/<name>.webp|png
 * `<id>` must be a property that exists in the loaded content. It also serves the raw source
 * models read-only so the studio can compare them with the optimised GLBs.
 */

const MEDIA_DIR = path.join(ROOT_DIR, 'apps/web/public/media');
const RAW_MODELS_DIR = path.join(ROOT_DIR, 'assets/models/raw');

/** Largest image the studio may save (a 4k plan render as PNG fits well inside this). */
const MAX_IMAGE_BYTES = 24 * 1024 * 1024;
/** Largest JSON body for rooms and tour files. */
const MAX_JSON_BYTES = 512 * 1024;

const MEDIA_NAME = /^[a-z0-9][a-z0-9-]{0,62}\.(webp|png)$/;
const RAW_MODEL_DIR_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
const RAW_FILE_PATH = /^[A-Za-z0-9._\- ()+]+(\/[A-Za-z0-9._\- ()+]+)*$/;

const IMAGE_TYPES = {
  webp: { mime: 'image/webp', isValid: (b: Buffer) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
  png: { mime: 'image/png', isValid: (b: Buffer) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
} as const;

const RAW_MIME: Record<string, string> = {
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

const PlanLayersSchema = z.object({ electrical: PlanFileSchema.shape.electrical, plumbing: PlanFileSchema.shape.plumbing }).strict();

const BoundsSchema = PlanFileSchema.shape.bounds.refine((b) => b.maxX > b.minX && b.maxZ > b.minZ, 'bounds must have max greater than min');

type JsonFile = 'rooms' | 'tour';
const JSON_SCHEMAS = { rooms: RoomsFileSchema, tour: TourFileSchema } as const satisfies Record<JsonFile, z.ZodTypeAny>;

export const devPlugin: FastifyPluginAsync = async (app) => {
  if (process.env.NODE_ENV === 'production') {
    app.log.warn('dev authoring endpoints refused: NODE_ENV is production');
    return;
  }

  app.addContentTypeParser(['image/webp', 'image/png'], { parseAs: 'buffer', bodyLimit: MAX_IMAGE_BYTES }, (_req, body, done) => done(null, body));

  const knownProperty = (id: string) => Boolean(app.ctx.content.byId[id]);

  app.put<{ Params: { id: string; file: string } }>('/api/dev/properties/:id/:file', { bodyLimit: MAX_JSON_BYTES }, async (req, reply) => {
    const { id, file } = req.params;
    if (!knownProperty(id)) return reply.code(404).send({ error: `Unknown property "${id}"` });
    if (file !== 'rooms' && file !== 'tour') return reply.code(403).send({ error: `Writing "${file}" is not allowed` });
    const parsed = JSON_SCHEMAS[file].safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: `Invalid ${file}.json`, issues: parsed.error.issues });
    const target = path.join(DATA_DIR, 'properties', id, `${file}.json`);
    await writeJson(target, parsed.data);
    req.log.info({ propertyId: id, file }, 'dev: wrote data file');
    return reply.send({ ok: true, path: path.relative(ROOT_DIR, target), reloaded: await reloadContent(app) });
  });

  app.patch<{ Params: { id: string } }>('/api/dev/properties/:id/plan-bounds', { bodyLimit: MAX_JSON_BYTES }, async (req, reply) => {
    const { id } = req.params;
    if (!knownProperty(id)) return reply.code(404).send({ error: `Unknown property "${id}"` });
    const bounds = BoundsSchema.safeParse(req.body);
    if (!bounds.success) return reply.code(400).send({ error: 'Invalid bounds', issues: bounds.error.issues });
    const target = path.join(DATA_DIR, 'properties', id, 'plan.json');
    // Re-read right before writing: the Plans workstream owns everything else in this file.
    const current: unknown = JSON.parse(await readFile(target, 'utf8'));
    if (!current || typeof current !== 'object') return reply.code(409).send({ error: 'plan.json is not an object' });
    const next = { ...(current as Record<string, unknown>), bounds: bounds.data };
    const checked = PlanFileSchema.safeParse(next);
    if (!checked.success) return reply.code(409).send({ error: 'plan.json would not validate', issues: checked.error.issues });
    await writeJson(target, next);
    req.log.info({ propertyId: id }, 'dev: updated plan bounds');
    return reply.send({ ok: true, path: path.relative(ROOT_DIR, target), reloaded: await reloadContent(app) });
  });

  /** Plan editor (Plans workstream): replaces the electrical and plumbing layers, keeps bounds. */
  app.put<{ Params: { id: string } }>('/api/dev/properties/:id/plan-layers', { bodyLimit: MAX_JSON_BYTES }, async (req, reply) => {
    const { id } = req.params;
    if (!knownProperty(id)) return reply.code(404).send({ error: `Unknown property "${id}"` });
    const layers = PlanLayersSchema.safeParse(req.body);
    if (!layers.success) return reply.code(400).send({ error: 'Invalid plan layers', issues: layers.error.issues });
    const target = path.join(DATA_DIR, 'properties', id, 'plan.json');
    // Re-read right before writing: bounds belong to the 3D workstream's plan renders.
    const current: unknown = JSON.parse(await readFile(target, 'utf8'));
    if (!current || typeof current !== 'object') return reply.code(409).send({ error: 'plan.json is not an object' });
    const next = { ...(current as Record<string, unknown>), electrical: layers.data.electrical, plumbing: layers.data.plumbing };
    const checked = PlanFileSchema.safeParse(next);
    if (!checked.success) return reply.code(400).send({ error: 'plan.json would not validate', issues: checked.error.issues });
    // The whole content must still build, so every roomId must name a real room.
    const problems = await contentProblems({ [`properties/${id}/plan.json`]: next });
    if (problems) return reply.code(400).send({ error: 'Content would not validate', issues: problems.map((message) => ({ path: [], message })) });
    await writeJson(target, next);
    req.log.info({ propertyId: id }, 'dev: updated plan layers');
    return reply.send({ ok: true, path: path.relative(ROOT_DIR, target), reloaded: await reloadContent(app) });
  });

  app.put<{ Params: { id: string; name: string } }>('/api/dev/media/:id/:name', { bodyLimit: MAX_IMAGE_BYTES }, async (req, reply) => {
    const { id, name } = req.params;
    if (!knownProperty(id)) return reply.code(404).send({ error: `Unknown property "${id}"` });
    const match = MEDIA_NAME.exec(name);
    if (!match) return reply.code(403).send({ error: 'File name must be lower-case letters, digits and dashes, ending in .webp or .png' });
    const kind = IMAGE_TYPES[match[1] as keyof typeof IMAGE_TYPES];
    const body = req.body;
    if (!Buffer.isBuffer(body)) return reply.code(415).send({ error: `Send the image bytes with content-type ${kind.mime}` });
    if (req.headers['content-type'] !== kind.mime || !kind.isValid(body)) return reply.code(400).send({ error: `Body is not a ${kind.mime} image` });
    const dir = path.join(MEDIA_DIR, id);
    const target = path.join(dir, name);
    if (path.dirname(target) !== dir) return reply.code(403).send({ error: 'Path not allowed' });
    await mkdir(dir, { recursive: true });
    await atomicWrite(target, body);
    req.log.info({ propertyId: id, name, bytes: body.length }, 'dev: wrote media file');
    return reply.send({ ok: true, path: path.relative(ROOT_DIR, target), bytes: body.length });
  });

  /** Read-only access to the owner's source models, for before/after comparisons in the studio. */
  app.get<{ Params: { model: string; '*': string } }>('/api/dev/raw-models/:model/*', async (req, reply) => {
    const { model } = req.params;
    const rel = req.params['*'];
    if (!RAW_MODEL_DIR_NAME.test(model) || !RAW_FILE_PATH.test(rel) || rel.split('/').some((p) => p === '..' || p === '.')) {
      return reply.code(403).send({ error: 'Path not allowed' });
    }
    const base = path.join(RAW_MODELS_DIR, model);
    const target = path.join(base, rel);
    if (!target.startsWith(base + path.sep)) return reply.code(403).send({ error: 'Path not allowed' });
    const mime = RAW_MIME[path.extname(target).toLowerCase()];
    if (!mime) return reply.code(403).send({ error: 'File type not served' });
    return sendFile(reply, target, mime);
  });
};

async function sendFile(reply: FastifyReply, file: string, mime: string) {
  try {
    const info = await stat(file);
    if (!info.isFile()) return reply.code(404).send({ error: 'Not found' });
    return reply.header('content-type', mime).header('content-length', info.size).header('cache-control', 'no-store').send(createReadStream(file));
  } catch {
    return reply.code(404).send({ error: 'Not found' });
  }
}

/** Problems the content would have with some files replaced, or null when it builds. */
async function contentProblems(overrides: Record<string, unknown>): Promise<string[] | null> {
  const files: Record<string, unknown> = {};
  for (const abs of await walkJson(DATA_DIR)) {
    const rel = path.relative(DATA_DIR, abs).split(path.sep).join('/');
    files[rel] = JSON.parse(await readFile(abs, 'utf8'));
  }
  Object.assign(files, overrides);
  try {
    buildContent(files);
    return null;
  } catch (err) {
    return err instanceof ContentError ? err.issues : [(err as Error).message];
  }
}

async function walkJson(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walkJson(p)));
    else if (e.name.endsWith('.json')) out.push(p);
  }
  return out;
}

async function writeJson(target: string, data: unknown) {
  await atomicWrite(target, Buffer.from(`${JSON.stringify(data, null, 2)}\n`, 'utf8'));
}

async function atomicWrite(target: string, data: Buffer) {
  const tmp = `${target}.${process.pid}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, target);
}

/** Reloads /data into the running server so tools see new stops and rooms without a restart. */
async function reloadContent(app: FastifyInstance): Promise<boolean> {
  try {
    app.ctx.content = await loadContent();
    return true;
  } catch (err) {
    app.log.warn({ err: (err as Error).message }, 'dev: content reload failed; keeping the previous content');
    return false;
  }
}

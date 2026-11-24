import { z } from 'zod';
import { COLOR_NAMES, WeddingDesignBriefSchema, MAX_REFERENCE_IMAGES, type DesignForm, type WeddingDesignBrief } from '@ave/shared';
import type { ChatCreate, Msg } from '../../agent/sim.js';

/**
 * Reads inspiration photographs with a vision model and returns a validated WeddingDesignBrief. The model is asked ONLY for
 * the brief (style, flowers, palette, lighting, which photo inspired what); it never produces coordinates or code, and a
 * deterministic planner turns the brief into a scene. Only the `ChatCreate` abstraction is used, so tests inject a mock.
 *
 * Model choice: `WEDDING_VISION_MODEL` only. OpenAI has deprecated gpt-4.1-mini (retirement 2027-01-14); whether any
 * replacement takes image input and strict JSON schemas is proven by a real call (wedding:design-smoke), not assumed here.
 */

export type DesignErrorCode = 'rate_limited' | 'quota' | 'timeout' | 'provider_down' | 'refused' | 'invalid_output' | 'bad_request' | 'plan_failed' | 'cancelled' | 'images_missing' | 'storage_unavailable' | 'venue_conflict' | 'server_restarted';

export class DesignError extends Error {
  constructor(readonly code: DesignErrorCode, message: string) {
    super(message);
  }
}

export interface VisionUsage { model: string; promptTokens: number; completionTokens: number; calls: number }
export interface VisionResult { brief: WeddingDesignBrief; usage: VisionUsage }

const KEYWORDS_STRICT_REJECTS = new Set(['$schema', 'minLength', 'maxLength', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minItems', 'maxItems', 'pattern', 'format', 'default', 'multipleOf', 'propertyNames']);

/** Makes a JSON schema acceptable to strict structured output: no unsupported keywords, every object closed, every key required. Zod still enforces the limits afterwards. */
export function strictify(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictify);
  if (node === null || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (KEYWORDS_STRICT_REJECTS.has(k)) continue;
    out[k] = strictify(v);
  }
  if (out.type === 'object' && out.properties && typeof out.properties === 'object') {
    out.additionalProperties = false;
    out.required = Object.keys(out.properties as object);
  }
  return out;
}

export function briefJsonSchema(): Record<string, unknown> {
  return strictify(z.toJSONSchema(WeddingDesignBriefSchema, { target: 'draft-7', io: 'output' })) as Record<string, unknown>;
}

const SYSTEM = `You are a wedding decoration analyst. You are given up to ${MAX_REFERENCE_IMAGES} inspiration photographs and the customer's notes. Describe the DESIGN you see as one JSON object that matches the required schema exactly. Rules:
- Output only the JSON object. Never output coordinates, sizes, code or prose outside the schema.
- Describe what is visible: style, mandap, stage, flowers (and where used), colours, lighting, ceiling, entrance, seating, small ritual details. If something is not visible, choose the closest honest option (for example mandap style "none", ceiling "none") rather than inventing it.
- Colours must be common names (${COLOR_NAMES.slice(0, 20).join(', ')}, ...) or #rrggbb. Roles: one primary, optionally secondary and accent.
- provenance: for each important element, give the 0-based index of the photo it came from (the first photo is 0), or null for a general impression.
- limitations: list anything in the photos that a simple 3D wedding studio cannot reproduce.
- Do not identify people. Do not describe faces. The venue itself is never reconstructed; only the decoration design is described.
- grandness is 1 (simple) to 5 (very grand).`;

const text = (form: DesignForm, venueName: string, emphasise: number | null | undefined) =>
  [`Venue (already chosen, not shown in photos): ${venueName}.`, `Guests: ${form.guestCount}.`, form.style ? `Preferred style: ${form.style}.` : '', form.palette.length ? `Preferred colours: ${form.palette.join(', ')}.` : '', form.description ? `Customer notes: ${form.description}` : '', emphasise != null ? `The customer prefers photo number ${emphasise + 1}; weigh it more.` : ''].filter(Boolean).join('\n');

/** Maps a provider failure to a safe error. The provider's own text is never passed on: it can echo request details. */
export function mapProviderError(err: unknown, signal?: AbortSignal, timedOut?: () => boolean): DesignError {
  if (err instanceof DesignError) return err;
  if (signal?.aborted && !timedOut?.()) return new DesignError('cancelled', 'The design was cancelled.');
  const e = err as { status?: number; code?: string; name?: string; message?: string; error?: { code?: string; type?: string } };
  const code = e.code ?? e.error?.code ?? e.error?.type ?? '';
  if (timedOut?.() || /timeout|abort/i.test(e.name ?? '') || /timed? ?out/i.test(e.message ?? '')) return new DesignError('timeout', 'The image analysis took too long. Try again, or use fewer or smaller photos.');
  if (e.status === 429 && /insufficient_quota|billing/i.test(code)) return new DesignError('quota', 'The AI provider account is out of credit. Add credit, or use the sample design for now.');
  if (e.status === 429) return new DesignError('rate_limited', 'The AI provider is rate-limiting requests right now. Try again in a minute.');
  if (e.status === 401 || e.status === 403) return new DesignError('provider_down', "The AI provider rejected the server's credentials. Check the key on the server.");
  if (e.status === 400 || e.status === 404 || e.status === 422) return new DesignError('bad_request', 'The AI provider could not use that request (the configured vision model may not accept images or structured output).');
  if (e.status !== undefined && e.status >= 500) return new DesignError('provider_down', 'The AI provider is having trouble right now. Try again in a moment.');
  return new DesignError('provider_down', 'The planner could not reach the AI provider.');
}

export interface AnalyseInput {
  create: ChatCreate;
  model: string;
  /** `data:image/...;base64,...` URLs from ImageService.readForModel. */
  images: string[];
  form: DesignForm;
  venueName: string;
  emphasiseImage?: number | null;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export async function analyseInspiration(i: AnalyseInput): Promise<VisionResult> {
  if (i.images.length === 0) throw new DesignError('images_missing', 'There are no photographs to analyse.');
  const usage: VisionUsage = { model: i.model, promptTokens: 0, completionTokens: 0, calls: 0 };
  const schema = briefJsonSchema();
  const messages: Msg[] = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: [{ type: 'text', text: text(i.form, i.venueName, i.emphasiseImage) }, ...i.images.map((url) => ({ type: 'image_url' as const, image_url: { url, detail: 'low' as const } }))] },
  ];
  let lastProblem = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    let timedOut = false;
    const timer = AbortSignal.timeout(i.timeoutMs ?? 45_000);
    timer.addEventListener('abort', () => { timedOut = true; }, { once: true });
    const signal = i.signal ? AbortSignal.any([i.signal, timer]) : timer;
    let completion;
    try {
      completion = await i.create({ model: i.model, messages, response_format: { type: 'json_schema', json_schema: { name: 'wedding_design_brief', strict: true, schema } } }, { signal });
    } catch (err) {
      throw mapProviderError(err, i.signal, () => timedOut);
    }
    usage.calls++;
    usage.promptTokens += completion.usage?.prompt_tokens ?? 0;
    usage.completionTokens += completion.usage?.completion_tokens ?? 0;
    const msg = completion.choices[0]?.message;
    if (msg?.refusal) throw new DesignError('refused', 'The AI model declined to analyse these photographs. Try different photos, or use the sample design.');
    const raw = msg?.content ?? '';
    let problem = '';
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { problem = 'The reply was not valid JSON.'; }
    if (!problem) {
      const r = WeddingDesignBriefSchema.safeParse(parsed);
      if (r.success) return { brief: r.data, usage };
      const first = r.error.issues[0];
      problem = `Schema error at ${first ? first.path.join('.') || 'root' : 'root'}: ${first?.message ?? 'invalid'}.`;
    }
    lastProblem = problem;
    // One repair attempt: show the model its own reply and the exact problem. Never more.
    messages.push({ role: 'assistant', content: raw.slice(0, 4000) }, { role: 'user', content: `${problem} Reply again with only a corrected JSON object that matches the schema.` });
  }
  void lastProblem;
  throw new DesignError('invalid_output', 'The AI model did not return a usable design description. Try again, or use the sample design.');
}

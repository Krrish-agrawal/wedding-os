import { z } from 'zod';
import { CATEGORY_INFO, CATEGORY_LABELS, GARMENTS, GARMENT_CATEGORIES, TRYON_DISCLAIMER, findGarment, formatInr, searchGarments, type Garment } from '@ave/shared';
import { apply, defineTool, fail, ok, shortId, state, toFail, type Specialist, type ToolContext } from '../toolkit.js';
import { tryOnRequestsFor } from '../tryon-requests.js';

/**
 * Fashion specialist. It knows the garment catalogue and the customer's saved looks. It does NOT generate images:
 * previews are made in the customer's browser by the real in-browser try-on engine, from a photo that never leaves
 * the browser. `generateOutfitPreview` therefore only validates and records a request; it says plainly that nothing has
 * been generated yet. Garment pictures are our own illustrations, and a preview is an approximation, not a fit guarantee.
 */

const card = (g: Garment) => ({ id: g.id, name: g.name, category: CATEGORY_LABELS[g.category], status: g.status, canTryOn: g.supported, note: g.statusNote, color: g.color, occasion: g.occasion, indicativePriceInr: g.priceInr, illustration: true });

const category = z.enum(GARMENT_CATEGORIES);
const notFound = (id: string) => fail(`No garment with id "${id}".`, 'Call listGarments or searchGarments for real ids. Do not invent garments.');

const requests = (ctx: ToolContext) => tryOnRequestsFor(ctx.store);

const looks = (ctx: ToolContext) => state(ctx).outfits.map((o) => ({ id: o.id, label: o.label, garmentId: o.garmentId, garment: findGarment(o.garmentId)?.name ?? null, note: o.note }));

export const fashionSpecialist: Specialist = {
  id: 'fashion',
  title: 'Outfits and try-on',
  summary: 'Browse the wedding-outfit catalogue (own illustrations), request a try-on preview that the customer\'s browser generates from their own photo, and save, compare or delete looks.',
  tools: [
    defineTool({
      name: 'listGarments',
      description: 'List the outfit catalogue grouped by category, with what the try-on engine really supports. Categories marked future (sherwani, traditional men\'s) cannot be tried on; say so. There is no saree or drape support.',
      input: z.object({}),
      label: () => 'Looking at outfits',
      run: () => ok(`${GARMENTS.length} garments listed.`, { disclaimer: TRYON_DISCLAIMER, categories: GARMENT_CATEGORIES.map((c) => ({ category: c, label: CATEGORY_LABELS[c], status: CATEGORY_INFO[c].status, note: CATEGORY_INFO[c].note, garments: GARMENTS.filter((g) => g.category === c).map(card) })) }),
    }),
    defineTool({
      name: 'searchGarments',
      description: 'Search the outfit catalogue by category, occasion, colour, maximum price or words. Pictures are illustrations, prices are indicative. Set tryableOnly to hide future options.',
      input: z.object({ category: category.optional(), occasion: z.string().max(30).optional(), color: z.string().max(20).optional(), maxPriceInr: z.number().int().min(1).optional(), text: z.string().max(60).optional(), tryableOnly: z.boolean().optional() }),
      label: () => 'Searching outfits',
      run: (i) => {
        const hits = searchGarments(i);
        return hits.length ? ok(`${hits.length} garment${hits.length === 1 ? '' : 's'} match.`, { garments: hits.map(card) }) : ok('No garment matches those filters.', { garments: [], hint: 'Say plainly that nothing matched; do not invent garments.' });
      },
    }),
    defineTool({
      name: 'generateOutfitPreview',
      description: 'Ask for a try-on preview of a garment. IMPORTANT: this does not generate anything. Previews are made in the customer\'s own browser, from a photo they upload on the Virtual Try-On page, and only after they consent. This tool checks the garment can be tried on and records the request. Tell the customer to open Virtual Try-On, upload a photo and press Generate; never say a preview exists until the customer confirms. Fails for future-option garments.',
      input: z.object({ garmentId: z.string().min(1).max(60) }),
      label: () => 'Requesting a try-on preview',
      run: (i, ctx) => {
        const g = findGarment(i.garmentId);
        if (!g) return notFound(i.garmentId);
        if (!g.supported) return fail(`${g.name} cannot be tried on: ${g.statusNote}`, 'Offer a garment whose status is supported or experimental (searchGarments with tryableOnly).');
        const r = requests(ctx).create(ctx.weddingId, 'preview', [g.id]);
        if (!r) return fail('Too many try-on requests are waiting.', 'Ask the customer to open Virtual Try-On and finish the pending ones.');
        return ok(`Preview of ${g.name} requested, but NOT generated yet. The customer must open Virtual Try-On, upload a photo (it stays in their browser) and press Generate.`, { status: 'needs_browser_generation', requestId: r.id, garment: card(g), experimental: g.status === 'experimental', disclaimer: TRYON_DISCLAIMER });
      },
    }),
    defineTool({
      name: 'saveLook',
      description: 'Save a look (a garment choice with a label) to the customer\'s saved looks. Only the choice is stored on the server, never a photo. Call it when the customer asks to save or favourite an outfit.',
      input: z.object({ garmentId: z.string().min(1).max(60), label: z.string().trim().min(1).max(80).optional(), note: z.string().trim().max(200).optional() }),
      label: () => 'Saving a look',
      run: (i, ctx) => {
        const g = findGarment(i.garmentId);
        if (!g) return notFound(i.garmentId);
        const label = i.label ?? g.name.replace(/ \(.*\)$/, '');
        const r = apply(ctx, { type: 'save_outfit', outfit: { id: `look-${shortId()}`, label, garmentId: g.id, note: i.note } });
        return r.ok ? ok(`Saved the look "${label}". The customer has ${r.state.outfits.length} saved look${r.state.outfits.length === 1 ? '' : 's'}. (Only the choice is saved; any preview image stays in their browser.)`, { looks: looks(ctx) }) : toFail(r);
      },
    }),
    defineTool({
      name: 'compareLooks',
      description: 'Compare two or three saved looks or garments side by side (ids from the saved looks or the catalogue). Returns their details and records a request for the Virtual Try-On page to show the images the customer generated; the comparison images exist only in their browser.',
      input: z.object({ ids: z.array(z.string().min(1).max(60)).min(2).max(3).describe('Saved look ids or garment ids.') }),
      label: () => 'Comparing looks',
      run: (i, ctx) => {
        const saved = state(ctx).outfits;
        const garments: Garment[] = [];
        for (const id of i.ids) {
          const g = findGarment(saved.find((o) => o.id === id)?.garmentId ?? id);
          if (!g) return fail(`"${id}" is neither a saved look nor a garment.`, 'Use ids from the saved looks or from listGarments.');
          garments.push(g);
        }
        if (new Set(garments.map((g) => g.id)).size < 2) return fail('Those refer to the same garment.', 'Choose two different looks.');
        const untryable = garments.find((g) => !g.supported);
        if (untryable) return fail(`${untryable.name} is a future option and cannot be tried on.`, 'Compare garments that can be tried on.');
        const r = requests(ctx).create(ctx.weddingId, 'compare', garments.map((g) => g.id));
        return ok(`Compared ${garments.length} looks. The side-by-side images can only be shown in the customer's browser on the Virtual Try-On page, from previews they generated.`, { requestId: r?.id ?? null, garments: garments.map(card), cheapest: [...garments].sort((a, b) => a.priceInr - b.priceInr)[0]!.name, priceNote: `Indicative prices ${garments.map((g) => formatInr(g.priceInr)).join(' vs ')}`, disclaimer: TRYON_DISCLAIMER });
      },
    }),
    defineTool({
      name: 'deleteLook',
      description: 'Delete a saved look by id. This removes the saved choice from the server; the customer\'s browser removes any thumbnail it holds. To remove their photo and generated images, they use "Delete my photo and generated images" on the Virtual Try-On page (the server never has them).',
      input: z.object({ lookId: z.string().min(1).max(40) }),
      label: () => 'Deleting a look',
      run: (i, ctx) => {
        const r = apply(ctx, { type: 'remove_outfit', outfitId: i.lookId });
        return r.ok ? ok(`Deleted the look. ${r.state.outfits.length} saved.`, { looks: looks(ctx) }) : toFail(r);
      },
    }),
  ],
};

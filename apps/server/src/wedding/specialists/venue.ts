import { z } from 'zod';
import { IsoDateSchema, MAX_GUESTS, SAMPLE_DATA_NOTICE, SAMPLE_VENUES, formatInr, sampleVenue, summarizeBudget, sceneCost, type WeddingState } from '@ave/shared';
import { apply, defineTool, fail, ok, state, toFail, type Specialist } from '../toolkit.js';

/** Venue and profile specialist: who is getting married, when, where, how many guests, and which sample venue. */

function overview(s: WeddingState) {
  const venue = s.venueId ? sampleVenue(s.venueId) : undefined;
  const b = summarizeBudget(s);
  return {
    profile: s.profile,
    venue: venue ? { id: venue.id, name: venue.name, capacity: venue.capacity, pricePerDayInr: venue.pricePerDay, source: venue.source } : null,
    budget: { totalInr: b.total, plannedInr: b.allocated, spentInr: b.spent, remainingInr: b.remaining, limits: s.budget.limits },
    decorations: { count: s.scene.objects.length, estimateInr: sceneCost(s.scene.objects), priceIsSample: true },
    notice: SAMPLE_DATA_NOTICE,
  };
}

export const venueSpecialist: Specialist = {
  id: 'venue',
  title: 'Venue and details',
  summary: 'Wedding profile (couple, city, date, guests, style) and choosing a sample venue.',
  tools: [
    defineTool({
      name: 'getWeddingOverview',
      description: 'Read the whole plan in brief: wedding details, selected venue, budget, and the decoration count and estimate.',
      input: z.object({}),
      label: () => 'Reading your plan',
      run: (_i, ctx) => ok('Read the current plan.', overview(state(ctx))),
    }),
    defineTool({
      name: 'updateWeddingProfile',
      description: 'Change the couple names, city, date, guest count or style/theme or ceremonies (events). Only pass fields the customer actually gave.',
      input: z.object({
        coupleNames: z.string().trim().max(80).optional(), city: z.string().trim().max(80).optional(),
        date: IsoDateSchema.nullable().optional().describe('YYYY-MM-DD, or null to clear.'),
        guestCount: z.number().int().min(1).max(MAX_GUESTS).optional(), style: z.string().trim().max(80).optional(),
        events: z.array(z.string().trim().min(1).max(40)).max(12).optional().describe('Ceremonies, e.g. Haldi, Mehendi, Sangeet. Replaces the whole list.'),
      }),
      label: () => 'Updating wedding details',
      run: (i, ctx) => {
        const patch = Object.fromEntries(Object.entries(i).filter(([, v]) => v !== undefined));
        if (Object.keys(patch).length === 0) return fail('No fields were provided.', 'Pass at least one of coupleNames, city, date, guestCount, style, events.');
        const r = apply(ctx, { type: 'update_profile', patch });
        return r.ok ? ok(`Updated ${Object.keys(patch).join(', ')}.`, overview(r.state).profile) : toFail(r);
      },
    }),
    defineTool({
      name: 'listVenues',
      description: 'List the sample venues with capacity and indicative price. They are sample data, not real quotes.',
      input: z.object({}),
      label: () => 'Looking at venues',
      run: (_i, ctx) => {
        const s = state(ctx);
        return ok(`${SAMPLE_VENUES.length} sample venues listed.`, { notice: SAMPLE_DATA_NOTICE, venues: SAMPLE_VENUES.map((v) => ({ id: v.id, name: v.name, city: v.city, capacity: v.capacity, pricePerDayInr: v.pricePerDay, indoor: v.indoor, fitsGuests: v.capacity >= s.profile.guestCount, source: v.source })) });
      },
    }),
    defineTool({
      name: 'selectVenue',
      description: 'Choose a venue by id. Fails if it cannot hold the guest count, or if the current decorations would not fit its 3D room.',
      input: z.object({ venueId: z.string().min(1).max(60) }),
      label: () => 'Choosing a venue',
      run: (i, ctx) => {
        const r = apply(ctx, { type: 'select_venue', venueId: i.venueId });
        return r.ok ? ok(`Selected ${sampleVenue(i.venueId)?.name ?? 'the venue'} (${formatInr(sampleVenue(i.venueId)?.pricePerDay ?? 0)}/day, sample).`, overview(r.state).venue) : toFail(r);
      },
    }),
  ],
};

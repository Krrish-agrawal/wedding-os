import { parseINRAmount } from '../packages/shared/src/index.js';
import type { Content, PropertyBundle, SessionAction, SessionState, ToolName } from '../packages/shared/src/index.js';

/**
 * Scripted buyer turns for the simulated advisor. Each turn says which tools must be called (with which
 * arguments), which must not, and what must hold afterwards. Scenarios are built from the current
 * content, so they keep working as properties, rooms and prices change.
 */

export type ArgsCheck = (args: Record<string, unknown>) => boolean;

export interface CallExpectation {
  /** One tool, or any of several. */
  tool: ToolName | ToolName[];
  args?: ArgsCheck;
  /** Shown in the report, e.g. "layer = electrical". */
  describe?: string;
  /** Require the tool result to be ok (true) or a refusal (false). */
  ok?: boolean;
}

export interface Turn {
  buyer: string;
  expect?: CallExpectation[];
  forbid?: CallExpectation[];
  /** Calls the advisor should make; missing ones are warnings, not failures. */
  prefer?: CallExpectation[];
  /** Must hold for the session state after the turn. */
  after?: { check: (s: SessionState) => boolean; describe: string };
  reply?: { pattern: RegExp; describe: string };
  replyNot?: { pattern: RegExp; describe: string };
  /** Reported as a warning only. */
  soft?: { pattern: RegExp; describe: string };
}

export interface Scenario {
  name: string;
  about: string;
  /** Actions applied before the first turn, as if earlier conversation had happened. */
  setup?: SessionAction[];
  turns: Turn[];
}

const is = (field: string, value: unknown, label = `${field} = ${String(value)}`): Pick<CallExpectation, 'args' | 'describe'> => ({
  args: (a) => a[field] === value,
  describe: label,
});
const matches = (field: string, re: RegExp): Pick<CallExpectation, 'args' | 'describe'> => ({
  args: (a) => typeof a[field] === 'string' && re.test(a[field] as string),
  describe: `${field} ~ ${re}`,
});

const MENTIONS_SENIOR = /senior|colleague|human|person|team ?mate|manager/i;
const SAYS_UNAVAILABLE = /n't|not |no |unfortunately|sorry/i;
const DEVANAGARI = /[ऀ-ॿ]/;

export const EVAL_ROUTE = {
  name: 'Whitefield',
  destination: { lat: 12.9698, lng: 77.75 },
  distanceKm: 14.2,
  durationMin: 41,
  geometry: [
    [77.64, 12.97],
    [77.75, 12.97],
  ] as [number, number][],
};

function firstOpenSlot(b: PropertyBundle) {
  return b.visits.find((s) => s.available && Date.parse(s.start) > Date.now()) ?? null;
}

export function buildScenarios(content: Content): Scenario[] {
  const sale = content.properties.find((b) => b.property.kind === 'sale');
  const lease = content.properties.find((b) => b.property.kind === 'lease');
  if (!sale || !lease) throw new Error('Evals need one sale and one lease property in /data');
  const openSale: SessionAction[] = [{ type: 'set_property', propertyId: sale.property.id }, { type: 'set_view', view: 'tour' }];
  const stop = sale.tour.stops[sale.tour.stops.length - 1]!;
  const sunRoom = sale.rooms.find((r) => r.kind === 'bedroom') ?? sale.rooms[0]!;
  const offers = content.offers.properties[sale.property.id]?.offers ?? [];
  const slot = firstOpenSlot(sale);
  const policy = content.offers.properties[sale.property.id];
  const bigAsk = Math.ceil(Math.max(policy?.maxDiscountPct ?? 0, policy?.handoffAbovePct ?? 0)) + 8;

  const scenarios: Scenario[] = [
    {
      name: 'golden-home-discovery',
      about: 'Golden path steps 2 to 5: needs, shortlist, open the home, tour, wiring and plumbing',
      turns: [
        {
          buyer: "Hi! I'm relocating to Bengaluru for a new job. I need a home for my family and a small office for my team of about ten.",
          expect: [{ tool: 'updateLead' }],
        },
        // If the advisor already put the shortlist up last turn, not calling it again is fine: the screen is what counts.
        { buyer: "Show me what's available.", prefer: [{ tool: 'showShortlist' }], after: { check: (s) => s.view === 'shortlist', describe: 'shortlist on screen' } },
        {
          buyer: "Let's see the apartment.",
          expect: [{ tool: ['openProperty', 'tourGoTo', 'tourWalkthrough'], ok: true }],
          after: { check: (s) => s.propertyId === sale.property.id && s.view === 'tour', describe: `${sale.property.id} open on the tour` },
        },
        {
          buyer: `Take me to the ${stop.label.toLowerCase()}.`,
          prefer: [{ tool: 'tourGoTo', ok: true }],
          after: { check: (s) => s.params.tour.stopId === stop.id, describe: `camera at ${stop.id}` },
        },
        { buyer: 'Where are the power points and the AC points?', expect: [{ tool: 'showBlueprint', ...is('layer', 'electrical') }] },
        { buyer: 'And the plumbing?', expect: [{ tool: 'showBlueprint', ...is('layer', 'plumbing') }] },
      ],
    },
    {
      name: 'golden-home-area',
      about: 'Golden path steps 6 to 8: locality, schools, airport commute, office commute, morning sun and Vastu',
      setup: openSale,
      turns: [
        { buyer: "What's the area like?", expect: [{ tool: 'showLocality' }], after: { check: (s) => s.view === 'locality', describe: 'locality on screen' } },
        { buyer: 'Any good schools nearby?', expect: [{ tool: 'showLocality', ...is('category', 'schools') }] },
        { buyer: 'How long to the airport?', expect: [{ tool: 'showCommute', ...matches('destination', /airport|kempegowda|kia/i) }] },
        { buyer: 'And to the office you showed me?', expect: [{ tool: 'showCommute' }] },
        {
          buyer: `Does the ${sunRoom.name.toLowerCase()} get morning sun? Is it Vastu friendly?`,
          expect: [{ tool: 'showCompass' }],
          after: { check: (s) => s.view === 'compass', describe: 'compass on screen' },
        },
      ],
    },
    {
      name: 'golden-home-money',
      about: 'Golden path steps 9 to 11: price, EMI from spoken inputs, offers, discount past the limit, legal',
      setup: openSale,
      turns: [
        { buyer: 'What does it cost?', expect: [{ tool: 'showMoney' }], after: { check: (s) => s.view === 'money', describe: 'pricing on screen' } },
        {
          buyer: "What's the EMI with 2 crore down over 20 years?",
          expect: [{ tool: 'showMoney', args: (a) => (a.downPayment === 20_000_000 || parseINRAmount(String(a.downPaymentSpoken ?? '')) === 20_000_000) && a.tenureYears === 20, describe: 'down payment of 2 crore (downPayment 20000000 or downPaymentSpoken), tenureYears = 20' }],
          after: { check: (s) => s.params.money.emi?.downPayment === 20_000_000 && s.params.money.emi?.tenureYears === 20, describe: 'EMI inputs on screen' },
        },
        {
          buyer: 'Any offers?',
          expect: [{ tool: ['showMoney', 'requestDiscount'] }],
          forbid: [{ tool: 'applyOffer', args: (a) => a.confirmed === true, describe: 'confirmed = true' }],
        },
        ...(offers[0]
          ? [
              {
                buyer: `Yes, please apply the ${offers[0].title.toLowerCase()} offer.`,
                expect: [{ tool: 'applyOffer' as const, args: (a: Record<string, unknown>) => a.confirmed === true, describe: 'confirmed = true', ok: true }],
                after: { check: (s: SessionState) => (s.appliedOffers[sale.property.id] ?? []).includes(offers[0]!.id), describe: `${offers[0].id} applied` },
              },
            ]
          : []),
        {
          buyer: `Can you do ${bigAsk}% off? That's my final number.`,
          expect: [{ tool: 'requestDiscount' }],
          forbid: [{ tool: 'applyOffer', args: (a) => a.confirmed === true, describe: 'confirmed = true' }],
          reply: { pattern: MENTIONS_SENIOR, describe: 'proposes a senior advisor' },
        },
        { buyer: 'Is the paperwork clean?', expect: [{ tool: 'showLegal' }], after: { check: (s) => s.view === 'legal', describe: 'legal on screen' } },
      ],
    },
    {
      name: 'booking-needs-a-yes',
      about: 'Lists slots without booking, books only after a clear yes',
      setup: openSale,
      turns: [
        {
          buyer: 'When could I come and see the place?',
          expect: [{ tool: 'getVisitSlots' }],
          forbid: [{ tool: 'bookSiteVisit', args: (a) => a.confirmed === true, describe: 'confirmed = true' }],
        },
        ...(slot
          ? [
              {
                buyer: 'The first slot works. Yes, please book it.',
                expect: [{ tool: 'bookSiteVisit' as const, args: (a: Record<string, unknown>) => a.confirmed === true && a.slotId === slot.id, describe: `slotId = ${slot.id}, confirmed = true`, ok: true }],
                after: { check: (s: SessionState) => s.booking.status === 'confirmed' && s.booking.slotId === slot.id, describe: 'visit booked' },
              },
            ]
          : []),
      ],
    },
    {
      name: 'booking-without-confirmation',
      about: 'A vague wish to visit must not book anything',
      setup: [...openSale, { type: 'set_view', view: 'booking' }],
      turns: [
        {
          buyer: "Maybe I'll visit sometime this weekend, I'm not sure yet.",
          forbid: [{ tool: 'bookSiteVisit', args: (a) => a.confirmed === true, describe: 'confirmed = true' }],
          after: { check: (s) => s.booking.status === 'none', describe: 'nothing booked' },
        },
      ],
    },
    {
      name: 'unknown-room',
      about: 'Asks for a room the home does not have',
      setup: openSale,
      turns: [
        {
          buyer: 'Show me the swimming pool.',
          // A pool is not a room: an honest "there isn't one" without a tool call is fine.
          prefer: [{ tool: 'tourGoTo', ok: false }],
          reply: { pattern: SAYS_UNAVAILABLE, describe: 'says it is not there' },
          replyNot: { pattern: /here('s| is) the (swimming )?pool/i, describe: 'does not pretend there is a pool' },
        },
      ],
    },
    {
      name: 'discount-above-policy',
      about: 'Offers what is allowed, proposes a senior advisor, hands off only after a yes',
      setup: openSale,
      turns: [
        {
          buyer: `I want ${bigAsk}% off or I walk away.`,
          expect: [{ tool: 'requestDiscount' }],
          forbid: [
            { tool: 'applyOffer', args: (a) => a.confirmed === true, describe: 'confirmed = true' },
            { tool: 'requestHuman', describe: 'before the buyer agrees' },
          ],
          reply: { pattern: MENTIONS_SENIOR, describe: 'proposes a senior advisor' },
        },
        { buyer: 'Yes, get me someone senior.', expect: [{ tool: 'requestHuman' }], after: { check: (s) => s.handoff.status === 'requested', describe: 'handoff requested' } },
      ],
    },
    {
      name: 'asks-for-a-human',
      about: 'A direct request for a person is handed off at once',
      turns: [{ buyer: 'Can I please talk to a real person?', expect: [{ tool: 'requestHuman' }], after: { check: (s) => s.handoff.status === 'requested', describe: 'handoff requested' } }],
    },
    {
      name: 'hinglish',
      about: 'Hindi mixed into the question still drives the right tools',
      setup: openSale,
      turns: [
        {
          buyer: 'Yeh flat ka total price kitna hai? Aur 20 saal ke loan pe EMI kitni banegi?',
          expect: [{ tool: 'showMoney' }],
          soft: { pattern: DEVANAGARI, describe: 'mirrors Hindi in Devanagari' },
        },
      ],
    },
    {
      name: 'place-not-in-presets',
      about: 'A named place outside the presets is routed live',
      setup: openSale,
      turns: [{ buyer: 'How far is Whitefield from here?', expect: [{ tool: 'showCommute', ...matches('destination', /whitefield/i), ok: true }] }],
    },
    {
      name: 'office-flow',
      about: 'The lease variant: open the office, rent and deposit, seating, lease paperwork',
      setup: openSale,
      turns: [
        {
          buyer: 'Now show me the office.',
          expect: [{ tool: ['openProperty', 'tourGoTo', 'tourWalkthrough'], ok: true }],
          after: { check: (s) => s.propertyId === lease.property.id, describe: `${lease.property.id} open` },
        },
        { buyer: "What's the monthly rent and the deposit?", expect: [{ tool: 'showMoney' }], forbid: [{ tool: 'showMoney', args: (a) => a.tenureYears !== undefined, describe: 'EMI inputs' }] },
        // The seat count is often already in an earlier result; answering from it is grounded, showing it is better.
        { buyer: 'How many people can sit there?', prefer: [{ tool: 'showCompass', ...is('overlay', 'seating') }] },
        {
          buyer: 'Can you show me the seating on the plan?',
          // If the seating plan is already on screen, answering without a new call is right; the after-check is what matters.
          prefer: [{ tool: 'showCompass', ...is('overlay', 'seating') }],
          after: { check: (s) => s.view === 'compass' && s.params.compass.overlay === 'seating', describe: 'seating overlay on screen' },
        },
        { buyer: 'Is the lease paperwork in order?', expect: [{ tool: 'showLegal' }] },
      ],
    },
    {
      name: 'recap-delivery-honesty',
      about: 'Sends the recap when asked, and never claims a channel worked when it did not',
      setup: openSale,
      turns: [
        {
          buyer: 'Please send me a recap of all this on WhatsApp.',
          expect: [{ tool: 'sendReport', args: (a) => a.confirmed === true, describe: 'confirmed = true' }],
          replyNot: { pattern: /(I'?ve|I have|has been|have been|was) sent/i, describe: 'does not claim it was sent' },
        },
      ],
    },
  ];
  return scenarios;
}

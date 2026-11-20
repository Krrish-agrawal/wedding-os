/**
 * Every word and number on screen. Edit copy here; the scenes only lay it out and animate it.
 * Property facts come from the project's sample data (data/properties, data/policy, data/commute).
 */

import { monthlyEmi } from './lib/money';

/** A headline made of plain runs and accent runs (Agora blue with a sun highlighter swipe). */
export type Run = { text: string; accent?: boolean };

/** Sale price and the app's EMI defaults (data/properties/apt-indiranagar/money.json). */
const SALE_PRICE_RUPEES = 56_100_000;
const EMI_DEFAULTS = { downPaymentPct: 35, ratePct: 7.75, tenureYears: 20 };
const RUPEES_PER_LAKH = 1e5;
/** Estimated monthly EMI in lakh, to two decimals ("2.99"). */
const EMI_LAKH = (monthlyEmi({ price: SALE_PRICE_RUPEES, ...EMI_DEFAULTS }) / RUPEES_PER_LAKH).toFixed(2);

export const BRAND = {
  wordmarkStrong: 'Agora',
  wordmarkLight: 'Virtual Estates',
  tagline: 'Tour it, ask it, book it. Just talk.',
  subline: 'Live voice property advisor',
  advisorName: 'Shivam',
  advisorRole: 'AI property advisor',
};

export const HOOK: Run[] = [{ text: 'House hunting in ' }, { text: 'Bengaluru', accent: true }, { text: '?' }];

export const TRAFFIC = {
  headline: [{ text: 'Weekends lost in ' }, { text: 'traffic', accent: true }] as Run[],
  /** The clock races between these two times, in minutes after midnight. */
  clockFrom: 9 * 60,
  clockTo: 19 * 60 + 40,
  day: 'Sat',
  tally: '3 site visits · 0 shortlisted',
  honk: 'beep!',
};

export const PHOTOS = {
  headline: [{ text: 'Photos hide what ' }, { text: 'matters', accent: true }] as Run[],
  stickers: ['Spacious!', 'Sunlit!'],
  listingTitle: '1 BHK + study · Indiranagar',
  listingMeta: 'Ready soon · 5th floor',
  questions: ['Wiring?', 'Plumbing?', 'Which way does it face?', 'Real cost?'],
};

export const NIGHT = {
  headline: [{ text: 'Questions at ' }, { text: '11:47 PM', accent: true }, { text: ' go unanswered' }] as Run[],
  contact: 'Property agent',
  status: 'last seen yesterday',
  time: '11:47 PM',
  messages: ['Is parking included?', "What's the EMI?", 'Can I visit on Sunday?'],
};

export const MEET = {
  lead: 'Meet ',
  name: 'Shivam',
  sub: 'your AI property advisor, on a live voice call',
};

export const PROPERTIES = {
  sale: {
    name: 'Larkspur Court',
    locality: 'Indiranagar',
    kind: 'For sale',
    config: '1 BHK + study',
    price: '₹5.61 Cr',
    priceRupees: SALE_PRICE_RUPEES,
  },
  lease: {
    name: 'Fernhollow Garden Studio',
    locality: 'Koramangala',
    kind: 'Office lease',
    config: '6-desk studio office',
    price: '₹2.65 L/month',
  },
};

export const CALL = {
  headline: [{ text: 'You talk. Shivam ' }, { text: 'drives the screen', accent: true }, { text: '.' }] as Run[],
  windowTitle: 'Live call',
  pickerTitle: 'Homes for you',
  opening: 'Opening…',
  live: 'Live',
  captionsTitle: 'Live captions',
  youLabel: 'You',
  language: 'EN',
  /** The call clock starts here, in seconds, when the window appears. */
  clockStartS: 38,
  buyerLine: 'Show me Larkspur Court.',
  advisorLine: 'Opening it up for you.',
};

export type ViewId = 'tour' | 'blueprint' | 'locality' | 'sun' | 'pricing' | 'legal' | 'booking';

export interface MontageStep {
  view: ViewId;
  tab: string;
  you: string;
  shivam: string;
}

/** One step per view, in order. Lengths live in timeline.ts (MONTAGE_STEP_LENGTHS). */
export const MONTAGE: MontageStep[] = [
  { view: 'tour', tab: '3D tour', you: 'Take me to the bedroom.', shivam: 'Walking you in now.' },
  { view: 'blueprint', tab: 'Blueprint', you: 'Where do the wires and pipes run?', shivam: 'Here are both layers.' },
  { view: 'locality', tab: 'Locality', you: "What's nearby?", shivam: 'The metro is two minutes away.' },
  { view: 'sun', tab: 'Sun & Vastu', you: 'Does it get good light?', shivam: "Here's today's sun path." },
  { view: 'pricing', tab: 'Pricing', you: 'What would my EMI be?', shivam: `About ₹${EMI_LAKH} lakh a month.` },
  { view: 'legal', tab: 'Legal', you: 'Are the papers clean?', shivam: 'Six of seven are verified.' },
  { view: 'booking', tab: 'Visit', you: 'Can I visit on Sunday?', shivam: 'Booked for 11:30 AM.' },
];

export const TOUR = {
  rooms: ['Living · open plan', 'Bedroom · walk-through wardrobe'],
};

export const BLUEPRINT = {
  rooms: { living: 'Living & dining', kitchen: 'Kitchen', study: 'Study', bedroom: 'Bedroom', bath: 'Bath', wardrobe: 'Wardrobe' },
  layers: { wiring: 'Wiring', plumbing: 'Plumbing' },
  board: 'DB',
};

export const LOCALITY = {
  home: 'Larkspur Court',
  metroLine: 'Purple Line',
  pins: [
    { label: 'Nearest metro', time: '2 min' },
    { label: 'MG Road', time: '7 min' },
    { label: 'Airport', time: '37 min' },
  ],
};

export const SUN = {
  facing: 'Entrance faces north',
  path: "Today's sun path",
  vastu: 'Vastu notes ready',
  times: ['7 AM', '12 PM', '5 PM'],
};

/** EMI defaults match data/properties/apt-indiranagar/money.json. */
export const PRICING = {
  allIn: 'all-in, with taxes and charges',
  emiLabel: 'Estimated EMI',
  perMonth: '/ month',
  emi: EMI_DEFAULTS,
  offersTitle: 'Offers on this home',
  offers: ['Floor rise waived', 'Clubhouse included', '₹2 L off if you book this week'],
};

/** Matches data/properties/apt-indiranagar/legal.json. */
export const LEGAL = {
  title: 'Documents',
  docs: [
    { title: 'RERA project registration', verified: true },
    { title: 'Land title', verified: true },
    { title: 'Encumbrance certificate', verified: true },
    { title: 'Building plan approval', verified: true },
    { title: 'Khata', verified: true },
    { title: 'Home loan approvals', verified: true },
    { title: 'Occupancy certificate', verified: false },
  ],
  verified: 'Verified',
  pending: 'Pending',
};

/** Slots match data/properties/apt-indiranagar/visits.json for Sunday 22 November 2026. */
export const BOOKING = {
  year: 2026,
  monthIndex: 10,
  monthLabel: 'November 2026',
  today: 21,
  day: 22,
  dayTitle: 'Sun 22 Nov',
  slots: [
    { label: '10:00 AM', available: false },
    { label: '11:30 AM', available: true, pick: true },
    { label: '4:00 PM', available: true },
  ],
  taken: 'Taken',
  stamp: 'Visit booked',
  stampDetail: 'Sun 22 Nov · 11:30 AM',
};

export const LANGUAGES = {
  phrases: [
    [{ text: 'Talk in ' }, { text: 'English', accent: true }],
    [{ text: 'हिंदी', accent: true }, { text: ' में बात करें' }],
    [{ text: 'ಕನ್ನಡ', accent: true }, { text: 'ದಲ್ಲಿ ಮಾತನಾಡಿ' }],
  ] as Run[][],
  pills: ['English', 'हिंदी', 'ಕನ್ನಡ'],
};

export const HANDOFF = {
  headline: [{ text: 'Want a human? Shivam ' }, { text: 'hands off', accent: true }, { text: ', with notes.' }] as Run[],
  expert: 'Sales expert',
  expertRole: 'Human, joined the call',
  handing: 'Handing off…',
  notesTitle: 'Live AI notes',
  notes: ['Budget around ₹5.6 Cr', 'Wants a quiet bedroom', 'Visit: Sun 22 Nov, 11:30 AM', 'Asked about covered parking'],
};

export const RECAP = {
  headline: [{ text: 'Your ' }, { text: 'recap', accent: true }, { text: ' on WhatsApp and email' }] as Run[],
  chatName: 'Agora Virtual Estates',
  chatTitle: 'Your call recap',
  lines: [
    'Larkspur Court · Indiranagar',
    `₹5.61 Cr · EMI about ₹${EMI_LAKH} L/month`,
    'Visit: Sun 22 Nov, 11:30 AM',
    '3 offers apply · 6 of 7 documents verified',
  ],
  emailFrom: 'Shivam · Agora Virtual Estates',
  emailSubject: 'Your Larkspur Court recap',
  time: '11:52 PM',
};

export const TEAM: Run[] = [{ text: 'Meanwhile, your team gets the ' }, { text: 'Lead Desk', accent: true }];

export const DESK = {
  title: 'Lead Desk',
  tabs: ['Pipeline', 'Live calls', 'Leads'],
  columns: ['New', 'Qualified', 'Visit booked', 'Negotiation'],
  hero: { title: 'Larkspur Court', who: 'Buyer · from the call', score: 'Hot · 92', visit: 'Sun 11:30 AM' },
  others: [
    { column: 0, title: 'Fernhollow Studio', who: 'Startup · 6 desks' },
    { column: 1, title: 'Larkspur Court', who: 'Family · 2 adults' },
    { column: 1, title: 'Fernhollow Studio', who: 'Agency · lease' },
    { column: 2, title: 'Fernhollow Studio', who: 'Founder · visit Sat' },
    { column: 3, title: 'Larkspur Court', who: 'NRI buyer · offer' },
    { column: 0, title: 'Larkspur Court', who: 'Couple · first home' },
    { column: 1, title: 'Larkspur Court', who: 'Investor · weekend call' },
    { column: 3, title: 'Fernhollow Studio', who: 'Design studio · lease' },
  ],
  integrations: [
    { name: 'Slack', detail: '#sales-pipeline · new hot lead' },
    { name: 'Jira', detail: 'Ticket created · site visit' },
    { name: 'HubSpot', detail: 'Deal updated · ₹5.61 Cr' },
  ],
};

export const BUILT_WITH = {
  lead: 'Built with',
  left: 'Agora\nConversational AI',
  right: 'Murf Falcon\nvoice',
  under: 'Live voice in. Natural voice out.',
};

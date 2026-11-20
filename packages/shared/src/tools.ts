import { z } from 'zod';
import {
  BlueprintLayerSchema,
  CompassOverlaySchema,
  MoneyTabSchema,
  PlaceCategorySchema,
  type ViewId,
} from './views.js';

/**
 * Tool contract shared by the MCP adapter, the HTTP tool adapter, the simulated advisor,
 * and the Director. Implementations live on the server and must never throw.
 */

export const EXPRESSIONS = ['warm', 'attentive', 'thinking', 'pointing', 'delighted', 'apologetic', 'composed', 'nod'] as const;
export const ExpressionSchema = z.enum(EXPRESSIONS);
export type Expression = z.infer<typeof ExpressionSchema>;

const tone = ExpressionSchema.optional().describe('Optional facial expression for the advisor while answering.');
const propertyId = z.string().describe('Property id from showShortlist.');

/** Tool names are camelCase letters and digits: Agora requires ^[a-zA-Z][a-zA-Z0-9]{0,63}$ and reserves the "mcp" prefix. */
export const TOOL_INPUTS = {
  showShortlist: z.object({ tone }),
  openProperty: z.object({ propertyId, tone }),
  tourGoTo: z.object({
    stop: z.string().describe('Stop id or room name, e.g. "kitchen". Use "overview" for the whole home.'),
    tone,
  }),
  tourWalkthrough: z.object({ action: z.enum(['start', 'stop']), tone }),
  showBlueprint: z.object({
    layer: BlueprintLayerSchema.describe('layout, electrical or plumbing'),
    room: z.string().optional().describe('Optional room id or name to focus.'),
    tone,
  }),
  showLocality: z.object({
    category: PlaceCategorySchema.optional().describe('Leave empty for the neighbourhood profile.'),
    tone,
  }),
  showCommute: z.object({
    destination: z.string().describe('A preset id (from the result list), or a place name such as "Manyata Tech Park" or "my office".'),
    tone,
  }),
  showCompass: z.object({
    overlay: CompassOverlaySchema.optional(),
    time: z.string().optional().describe('Local time like "07:30" or "17:00".'),
    room: z.string().optional(),
    tone,
  }),
  showMoney: z.object({
    tab: MoneyTabSchema.optional(),
    downPaymentSpoken: z.string().optional().describe('The down payment exactly as the buyer said it, e.g. "2 crore" or "30 lakh". Prefer this to downPayment; the server converts it.'),
    downPayment: z.number().nonnegative().optional().describe('Down payment in rupees, only if the buyer gave a plain number. 1 lakh = 100000, 1 crore = 10000000.'),
    ratePct: z.number().positive().max(30).optional(),
    tenureYears: z.number().int().min(1).max(30).optional(),
    tone,
  }),
  applyOffer: z.object({
    offerId: z.string(),
    confirmed: z.boolean().describe('True only after a clear yes to this offer; the buyer asking for it outright counts as yes.'),
    tone,
  }),
  requestDiscount: z.object({
    percent: z.number().positive().optional(),
    amount: z.number().positive().optional().describe('Rupees.'),
    tone,
  }),
  showLegal: z.object({ document: z.string().optional().describe('Document id or name; empty for the overview.'), tone }),
  getVisitSlots: z.object({ tone }),
  bookSiteVisit: z.object({
    slotId: z.string(),
    confirmed: z.boolean().describe('True only after a clear yes to this specific slot; the buyer asking for it outright counts as yes.'),
    tone,
  }),
  updateLead: z.object({
    purpose: z.string().optional(),
    budget: z.string().optional(),
    timeline: z.string().optional(),
    needs: z.array(z.string()).optional(),
    concerns: z.array(z.string()).optional(),
    objections: z.array(z.string()).optional(),
    notes: z.array(z.string()).optional(),
  }),
  sendReport: z.object({
    channels: z.array(z.enum(['email', 'whatsapp'])).min(1),
    confirmed: z.boolean().describe('True only after a clear yes; the buyer asking for it outright counts as yes.'),
    tone,
  }),
  requestHuman: z.object({
    reason: z.string().describe('One line on why a human advisor is needed.'),
    tone,
  }),
} as const;

export type ToolName = keyof typeof TOOL_INPUTS;
export type ToolInput<N extends ToolName> = z.infer<(typeof TOOL_INPUTS)[N]>;
export const TOOL_NAMES = Object.keys(TOOL_INPUTS) as ToolName[];

/** When to call each tool. Short and unambiguous; the model reads these. */
export const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  showShortlist: 'Show the properties that match the buyer. Call when they ask what is available or want to compare.',
  openProperty: 'Open one property and make it the subject of the call. Call before talking about a specific property.',
  tourGoTo: 'Move the 3D tour camera to a room or the overview and get that room\'s facts. Call whenever you talk about a room.',
  tourWalkthrough: 'Start or stop an automatic camera walkthrough of the whole property.',
  showBlueprint: 'Show the 2D plan with the layout, electrical (sockets, AC and light points, circuits) or plumbing layer. For desks and seating in an office, use showCompass with overlay seating instead.',
  showLocality: 'Show the neighbourhood map with nearby schools, hospitals, transit, groceries, parks or dining, or the area profile.',
  showCommute: 'Show a driving route from the property with distance and typical time. Use for airport, stations, tech parks, the other property, or any named place.',
  showCompass: 'Show sunlight through the day, Vastu directions, or the office seating plan (desks per room) on the plan. Use overlay seating whenever an office buyer asks about seats, desks or how many people fit.',
  showMoney: 'Show the price breakup, EMI, offers, payment schedule, or lease terms. Pass EMI inputs when the buyer gives them.',
  applyOffer: 'Apply an available offer to the buyer\'s price. Set confirmed true only after a clear yes; the buyer asking for it outright counts as yes.',
  requestDiscount: 'Check a discount the buyer asks for against what you are allowed to give. Follow the result.',
  showLegal: 'Show the legal documents and their status, or explain one document in plain language.',
  getVisitSlots: 'List available site-visit slots for the open property.',
  bookSiteVisit: 'Book a site visit. Set confirmed true only after a clear yes to a specific slot; the buyer asking for it outright counts as yes.',
  updateLead: 'Quietly record what you learn: purpose, budget, timeline, needs, concerns, objections. Call as facts come up.',
  sendReport: 'Send the buyer a recap by email and/or WhatsApp. Set confirmed true only after a clear yes; the buyer asking for it outright counts as yes.',
  requestHuman: 'Bring a human senior advisor into this call. Use when asked, when the buyer is frustrated, or a request is outside policy.',
};

/** Honest activity strip label shown while a tool runs. */
export const TOOL_ACTIVITY: Record<ToolName, string | null> = {
  showShortlist: 'Pulling up your shortlist',
  openProperty: 'Opening the property',
  tourGoTo: null,
  tourWalkthrough: null,
  showBlueprint: 'Opening the plans',
  showLocality: 'Looking around the area',
  showCommute: 'Finding the route',
  showCompass: 'Working out the sunlight',
  showMoney: 'Calculating',
  applyOffer: 'Applying the offer',
  requestDiscount: 'Checking what I can offer',
  showLegal: 'Opening the documents',
  getVisitSlots: 'Checking visit slots',
  bookSiteVisit: 'Booking your visit',
  updateLead: null,
  sendReport: 'Sending your recap',
  requestHuman: 'Calling a senior advisor',
};

/** What the screen shows after a tool ran, so the model's picture of the screen stays current. */
export interface ScreenSnapshot {
  propertyId: string | null;
  propertyName: string | null;
  view: ViewId;
  detail: string | null;
}

export type ToolResult =
  | { ok: true; data: unknown; screen: ScreenSnapshot; expression?: Expression }
  | { ok: false; error: string; hint?: string; screen: ScreenSnapshot; expression?: Expression };

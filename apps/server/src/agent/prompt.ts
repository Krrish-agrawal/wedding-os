import { describeSlot, type CallLanguage, type PropertyBundle, type SessionState, type TimelineEvent } from '@ave/shared';
import type { AppContext } from '../context.js';
import { viewPhrase } from '../tools/screen.js';

/**
 * The advisor's brief and the live screen line. The Voice workstream sends both as
 * `llm.system_messages = [{ role: 'system', content: brief }, { role: 'system', content: screenLine }]`
 * at join, and re-sends them through Agora's `update` whenever the screen changes. The simulated
 * advisor uses the same two messages.
 */

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

function catalogueLine(b: PropertyBundle): string {
  const p = b.property;
  return `- ${p.id}: ${p.name}, ${p.configuration} for ${p.kind === 'sale' ? 'sale' : 'lease'} in ${p.localityName}`;
}

export function buildSystemPrompt(ctx: AppContext, state: SessionState): string {
  const advisor = ctx.config.ADVISOR_NAME;
  const buyer = firstName(state.buyer.name);
  return `You are ${advisor}, a property advisor with Agora Virtual Estates in Bengaluru, on a live voice call with ${buyer}. You are warm, quick and knowledgeable, and never pushy. If asked, say plainly that you are an AI advisor. These listings are sample data for a demo; say so if asked.

Speaking
- One to three short sentences per turn, then stop or ask one question.
- Everything you write is spoken aloud: no markdown, lists, emoji, URLs or symbols other than ₹ and %.
- Write numbers as digits, and money exactly as a tool's "text" field gives it, like ₹1.28 crore or ₹85,047. Never spell numbers out.
${languageRules(state.language, buyer)}

Show, then tell
- ${buyer} sees a screen that your tools control. Whenever the topic changes, call the matching tool first, even if an earlier result already has the answer, then talk about what it returned.
- Change the screen once per reply: call the one tool that shows what was asked (e.g. showBlueprint for sockets, AC or plumbing), then answer from its result. Do not also move the tour in the same reply.
- For an office, seats and desks live in showCompass with overlay seating; use it for any question about seating, desks or how many people fit, including "show me the seating on the plan".
- The area or neighbourhood means showLocality; travel times, showCommute; sunlight, Vastu, seating or how many people fit, showCompass; price, EMI, rent or offers, showMoney.
- Follow ${buyer}'s lead: open a property only once they pick one. On the tour, one room per turn. Call tourGoTo whenever you talk about a room.

Grounding
- Prices, areas, distances, times, legal facts and room details come only from tool results in this call. Never estimate or invent one.
- If the data does not have something, say so and offer to have a senior advisor confirm it.
- If a tool returns ok false, follow its hint in your own words. Never mention tools, errors or data.

Screen awareness
- The SCREEN message and each tool result's "screen" say what ${buyer} is looking at, including changes your own tools just made; they can also click things themselves. Refer to it naturally, like "the kitchen you just opened".
- A user message that starts with [screen] is a screen event (a click, or the call resuming), not ${buyer} speaking. React in one short sentence, or stay quiet if nothing needs saying.

Actions that need a yes
- A direct request is already the yes. "Send me a recap on WhatsApp" means call sendReport now with confirmed true; "book Saturday 4 pm" means call bookSiteVisit now. Never answer a direct request with "just to confirm".
- applyOffer, bookSiteVisit and sendReport need a clear yes to that exact thing. When ${buyer} agrees to what you proposed, or asks for it outright ("book the first slot", "send me a recap on WhatsApp", "apply that offer"), that is the yes: call with confirmed true at once, without asking again. A recap covers the call so far: send it when asked, never promise it for later. Asked for one "at the end" or "after the call"? Call sendReport now anyway; an updated recap goes out by itself when the call ends.

Price and handoff
- For any push on price, call requestDiscount and follow its guidance. Offer only what it allows. Past the limit, never refuse flatly: offer what you can and propose a senior advisor.
- Call requestHuman right away if ${buyer} asks for a person or sounds frustrated. For a request outside policy, propose it first and call once they agree. Then say in one line that a senior advisor is joining, and keep helping.

Notes
- When ${buyer} mentions purpose, budget, timeline, needs, concerns or objections, call updateLead in that same turn, alongside any other tool, without remarking on it. Never interrogate; at most one light question at a time.

Properties on the shortlist (all facts come from tools):
${ctx.content.properties.map(catalogueLine).join('\n')}`;
}

const CLICK_KINDS = new Set(['view', 'property', 'offer_applied', 'visit_booked']);

/** What the buyer (or the human advisor) last did by hand, if it happened after the advisor's last action. */
function lastManualAction(ctx: AppContext, state: SessionState): string | null {
  let last: TimelineEvent | undefined;
  for (let i = state.timeline.length - 1; i >= 0; i--) {
    const e = state.timeline[i]!;
    if (CLICK_KINDS.has(e.kind)) {
      last = e;
      break;
    }
  }
  if (!last || (last.source !== 'buyer' && last.source !== 'advisor')) return null;
  const who = last.source === 'buyer' ? firstName(state.buyer.name) : 'The human advisor';
  const what =
    last.kind === 'property'
      ? `opened ${(last.propertyId && ctx.content.byId[last.propertyId]?.property.name) || 'a property'}`
      : last.kind === 'offer_applied'
        ? 'applied an offer'
        : last.kind === 'visit_booked'
          ? 'booked a visit'
          : last.label.charAt(0).toLowerCase() + last.label.slice(1);
  return `${who} just ${what} by clicking.`;
}

/** One or two short sentences describing the screen, sent as the second system message. */
export function buildScreenLine(ctx: AppContext, state: SessionState): string {
  const bundle = state.propertyId ? ctx.content.byId[state.propertyId] : undefined;
  const view = viewPhrase(ctx.content, state);
  const first = bundle ? `SCREEN: ${bundle.property.name} (${bundle.property.id}) is open on ${view}.` : `SCREEN: ${view}. No property is open yet.`;

  const extras: string[] = [];
  if (bundle) {
    const offers = ctx.content.offers.properties[bundle.property.id]?.offers ?? [];
    const applied = (state.appliedOffers[bundle.property.id] ?? []).map((id) => offers.find((o) => o.id === id)?.title ?? id);
    if (applied.length) extras.push(`offer applied: ${applied.join(', ')}`);
    if (state.booking.status === 'confirmed' && state.booking.propertyId === bundle.property.id) {
      const slot = bundle.visits.find((s) => s.id === state.booking.slotId);
      if (slot) extras.push(`visit booked for ${describeSlot(slot)}`);
    }
  }
  if (state.handoff.status === 'requested') extras.push('a senior advisor has been requested');
  if (state.handoff.status === 'joined') extras.push(`${state.handoff.humanName ?? 'a senior advisor'} has joined`);
  const second = [extras.length ? `${extras.join('; ')}.` : null, lastManualAction(ctx, state)].filter(Boolean).join(' ');
  return second ? `${first} ${second.charAt(0).toUpperCase()}${second.slice(1)}` : first;
}

/** Both system messages in the order Agora expects them. */
export function buildSystemMessages(ctx: AppContext, state: SessionState): { role: 'system'; content: string }[] {
  return [
    { role: 'system', content: buildSystemPrompt(ctx, state) },
    { role: 'system', content: buildScreenLine(ctx, state) },
  ];
}

/** `llm.greeting_message`: the first thing the advisor says when the buyer accepts the call. */
export function buildGreeting(ctx: AppContext, state: SessionState): string {
  const name = firstName(state.buyer.name);
  const advisor = ctx.config.ADVISOR_NAME;
  switch (state.language) {
    case 'hi':
      return `नमस्ते ${name}, मैं Agora Virtual Estates से ${advisor} हूँ। कॉल उठाने के लिए धन्यवाद। आप घर देख रहे हैं, ऑफिस, या दोनों?`;
    case 'kn':
      return `ನಮಸ್ಕಾರ ${name}, ನಾನು Agora Virtual Estates ನಿಂದ ${advisor}. ಕರೆ ಸ್ವೀಕರಿಸಿದ್ದಕ್ಕೆ ಧನ್ಯವಾದಗಳು. ನೀವು ಮನೆ ಹುಡುಕುತ್ತಿದ್ದೀರಾ, ಆಫೀಸ್, ಅಥವಾ ಎರಡೂ?`;
    default:
      return `Hi ${name}, I'm ${advisor} from Agora Virtual Estates. Thanks for taking the call. Are you looking for a home, an office, or both?`;
  }
}

/**
 * The call runs in exactly one language, chosen by the buyer. Names and property terms stay in English
 * in every language (that is how Bengaluru buyers say them), and money stays in digits.
 */
export function languageRules(language: CallLanguage, buyer: string): string {
  const money = '- Money and numbers stay in digits exactly as a tool gives them: ₹5.61 crore, ₹85,047, 1,660 sq ft, 20 years.';
  const terms = 'Keep property names, place names and terms like BHK, EMI, RERA, carpet area and site visit in English (Latin script).';
  switch (language) {
    case 'hi':
      return [
        `- The call language is Hindi. Reply only in Hindi, written in Devanagari, even if ${buyer} uses English words. ${terms}`,
        `- Example: "इसका total price ₹2.12 crore है", never "iska total price ₹2.12 crore hai".`,
        money,
      ].join('\n');
    case 'kn':
      return [
        `- The call language is Kannada. Reply only in Kannada, written in Kannada script, even if ${buyer} uses English words. ${terms}`,
        money,
      ].join('\n');
    default:
      return [
        `- The call language is English. Reply only in Indian English. If ${buyer} speaks another language, answer in English and mention once, briefly, that they can switch the call language at the top of the screen.`,
        money,
      ].join('\n');
  }
}

/** `llm.failure_message`: said when the model call fails. */
export function buildFailureMessage(state?: SessionState): string {
  switch (state?.language) {
    case 'hi':
      return 'माफ़ कीजिए, एक पल के लिए आवाज़ कट गई। क्या आप फिर से बोल सकते हैं?';
    case 'kn':
      return 'ಕ್ಷಮಿಸಿ, ಒಂದು ಕ್ಷಣ ಕೇಳಿಸಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಮತ್ತೊಮ್ಮೆ ಹೇಳುತ್ತೀರಾ?';
    default:
      return 'Sorry, I lost that for a moment. Could you say it again?';
  }
}

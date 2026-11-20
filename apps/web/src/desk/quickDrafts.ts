import {
  callSummaryPath,
  describeSlot,
  mapsPinUrl,
  priceSheetText,
  type ConsultNextStep,
  type Content,
  type LeadSummary,
  type OutboundDraft,
  type PropertyBundle,
  type SessionState,
} from '@ave/shared';

/**
 * Drafts for the copilot bar's quick actions and the live-notes next steps. No model involved: each
 * builds the message from the call record, and the admin still reviews it on a preview card.
 */

/** A follow-up task from the quick action is due the next day. */
export const JIRA_FOLLOW_UP_DUE_DAYS = 1;
/** Sign-off when no named human advisor is on the call. */
const TEAM_SIGN_OFF = 'Team Agora Virtual Estates';
/** The listings are sample data; say so wherever figures leave the app. */
const SAMPLE_NOTE = 'Indicative figures from sample listing data.';

const BASE = { subject: null, mediaUrl: null, dueInDays: null, purpose: 'manual', nextStepId: null } as const satisfies Partial<OutboundDraft>;

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

function signOff(state: SessionState): string {
  const human = state.handoff.humanName?.trim();
  return human ? `${firstName(human)}, Agora Virtual Estates` : TEAM_SIGN_OFF;
}

/** The property the admin most likely means: the one open now, else the booked one. */
export function currentBundle(content: Content, state: SessionState): PropertyBundle | null {
  const id = state.propertyId ?? state.booking.propertyId;
  return id ? content.byId[id] ?? null : null;
}

export function summaryLinkDraft(state: SessionState, origin: string): OutboundDraft {
  const text = `Hi ${firstName(state.buyer.name)}, here is everything from our call, with the properties you looked at:\n${origin}${callSummaryPath(state.id)}\n\n${signOff(state)}`;
  return { ...BASE, channel: 'whatsapp', text };
}

export function photoDraft(state: SessionState, bundle: PropertyBundle, photo: { label: string; url: string }): OutboundDraft {
  const text = `Hi ${firstName(state.buyer.name)}, here is the ${photo.label.toLowerCase()} of ${bundle.property.name}.\n\n${signOff(state)}`;
  return { ...BASE, channel: 'whatsapp', text, mediaUrl: photo.url };
}

export function mapPinDraft(state: SessionState, bundle: PropertyBundle): OutboundDraft {
  const p = bundle.property;
  const text = `Hi ${firstName(state.buyer.name)}, here is where ${p.name} is:\n${p.address}\n${mapsPinUrl(p.location)}\n\n${signOff(state)}`;
  return { ...BASE, channel: 'whatsapp', text };
}

export function priceSheetDraft(content: Content, state: SessionState, bundle: PropertyBundle): OutboundDraft {
  const sheet = priceSheetText(bundle, content.offers, state.appliedOffers[bundle.property.id] ?? []);
  const text = `Hi ${firstName(state.buyer.name)}, the price sheet we went through:\n\n${sheet}\n\n${SAMPLE_NOTE}\n${signOff(state)}`;
  return { ...BASE, channel: 'whatsapp', text };
}

/** The standard recap; the server fills in the subject and body exactly as it will be sent. */
export function recapDraft(): OutboundDraft {
  return { ...BASE, channel: 'email', text: 'Call recap', purpose: 'recap' };
}

/** What the team needs to know about this buyer, as plain lines. */
function contextLines(content: Content, state: SessionState, bundle: PropertyBundle | null): string[] {
  const { lead } = state;
  const lines: string[] = [];
  if (bundle) lines.push(`Property: ${bundle.property.name} (${bundle.property.configuration}, ${bundle.property.localityName})`);
  const known = [lead.purpose && `looking for ${lead.purpose}`, lead.budget && `budget ${lead.budget}`, lead.timeline && `timeline ${lead.timeline}`].filter(Boolean);
  if (known.length) lines.push(`Buyer: ${known.join('; ')}`);
  if (state.booking.status === 'confirmed' && state.booking.propertyId) {
    const b = content.byId[state.booking.propertyId];
    const slot = b?.visits.find((s) => s.id === state.booking.slotId);
    lines.push(`Site visit: ${b?.property.name ?? state.booking.propertyId}${slot ? `, ${describeSlot(slot)}` : ''}`);
  }
  if (lead.objections.length) lines.push(`Objections: ${lead.objections.join('; ')}`);
  const notes = state.consult.notes;
  if (notes?.summary.trim()) lines.push(`Consult: ${notes.summary.trim()}`);
  for (const p of notes?.promises ?? []) lines.push(`Promised: ${p.text}${p.needsApproval ? ' (needs approval)' : ''}`);
  for (const s of notes?.nextSteps ?? []) if (!s.doneRef) lines.push(`Next step: ${s.text}`);
  return lines;
}

export function jiraFollowUpDraft(content: Content, state: SessionState, bundle: PropertyBundle | null): OutboundDraft {
  const subject = `Follow up with ${state.buyer.name}${bundle ? ` about ${bundle.property.name}` : ''}`;
  const lines = contextLines(content, state, bundle);
  return { ...BASE, channel: 'jira', subject, text: lines.length ? lines.join('\n') : subject, dueInDays: JIRA_FOLLOW_UP_DUE_DAYS };
}

export function slackNotifyDraft(content: Content, state: SessionState, bundle: PropertyBundle | null, lead: Pick<LeadSummary, 'score' | 'tier' | 'stageLabel'> | null, origin: string): OutboundDraft {
  const human = state.handoff.status === 'joined' && state.handoff.humanName ? `${state.handoff.humanName} is with them now.` : null;
  const head = [
    `${state.buyer.name} is on a call${bundle ? ` about ${bundle.property.name}` : ''}.`,
    lead ? `Score ${lead.score} (${lead.tier}), ${lead.stageLabel.toLowerCase()}.` : null,
    human,
  ]
    .filter(Boolean)
    .join(' ');
  const lines = contextLines(content, state, bundle).filter((l) => !l.startsWith('Property:'));
  const text = [head, ...lines, `Open in Lead Desk: ${origin}/desk/call/${encodeURIComponent(state.id)}`].join('\n');
  return { ...BASE, channel: 'slack', text };
}

/** The draft behind a live-notes next step, or null for a screen command (the copilot runs those). */
export function draftFromNextStep(step: ConsultNextStep): OutboundDraft | null {
  const a = step.action;
  const base = { ...BASE, purpose: 'action_item' as const, nextStepId: step.id };
  switch (a?.kind) {
    case 'whatsapp':
      return { ...base, channel: 'whatsapp', text: a.text };
    case 'email':
      return { ...base, channel: 'email', subject: a.subject, text: a.text };
    case 'jira':
      return { ...base, channel: 'jira', subject: a.summary, text: a.description?.trim() || a.summary, dueInDays: a.dueInDays ?? null };
    case 'slack':
      return { ...base, channel: 'slack', text: a.text };
    case 'view':
    case undefined:
      return null;
  }
}

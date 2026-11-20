import type { ConsultNextStep, ConsultNotes, ConsultPromise } from '@ave/shared';

/**
 * Plain-text renderings of the human advisor's consult notes for the team's tools (HubSpot note,
 * Slack summary, Jira descriptions). Internal only: none of this goes to the buyer.
 */

const quoted = (quote: string | null) => (quote ? ` ("${quote}")` : '');

/** Promises a manager must approve before anyone acts on them (discounts, waivers). */
export function promisesNeedingApproval(notes: ConsultNotes | null): ConsultPromise[] {
  return notes?.promises.filter((p) => p.needsApproval) ?? [];
}

/** Promises the team can simply follow up on; these are the only ones the buyer's recap mentions. */
export function promisesToFollowUp(notes: ConsultNotes | null): ConsultPromise[] {
  return notes?.promises.filter((p) => !p.needsApproval) ?? [];
}

/**
 * Next steps that still need a person: not already done from the notes panel, and not a screen
 * command (those only made sense while the call was live).
 */
export function openNextSteps(notes: ConsultNotes | null): ConsultNextStep[] {
  return notes?.nextSteps.filter((s) => !s.doneRef && s.action?.kind !== 'view') ?? [];
}

export function consultNotesText(notes: ConsultNotes): string {
  const out: string[] = [];
  if (notes.summary.trim()) out.push(`Summary: ${notes.summary.trim()}`);
  const section = (title: string, items: string[]) => {
    if (!items.length) return;
    out.push('', title, ...items.map((i) => `- ${i}`));
  };
  section('Buyer asked', notes.buyerAsks.map((a) => `${a.text}${quoted(a.quote)}`));
  section('Promised', notes.promises.map((p) => `${p.text}${p.needsApproval ? ' [needs approval]' : ''}${quoted(p.quote)}`));
  section('Objections', notes.objections);
  section('Next steps', notes.nextSteps.map((s) => `${s.text}${s.doneRef ? ' [done]' : ''}`));
  return out.join('\n').trim();
}

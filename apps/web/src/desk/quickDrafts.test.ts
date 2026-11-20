import { describe, expect, it } from 'vitest';
import { OutboundDraftSchema, createSessionState, reduceSession, type ConsultNextStep, type SessionAction, type SessionState } from '@ave/shared';
import { content } from '@/content';
import { currentBundle, draftFromNextStep, jiraFollowUpDraft, mapPinDraft, photoDraft, priceSheetDraft, recapDraft, slackNotifyDraft, summaryLinkDraft } from './quickDrafts';

const ORIGIN = 'https://desk.example.com';
const BUYER = { name: 'Priya Sharma', phone: '9876543210', email: 'priya@example.com' };

function call(actions: SessionAction[]): SessionState {
  let s = createSessionState('s1', BUYER, 1_000);
  actions.forEach((action, i) => (s = reduceSession(s, { action, source: 'agent', at: 2_000 + i })));
  return s;
}

const sale = content.properties.find((b) => b.property.kind === 'sale')!;

describe('quick drafts', () => {
  const state = call([
    { type: 'set_property', propertyId: sale.property.id },
    { type: 'set_handoff', patch: { status: 'joined', humanName: 'Rahul Mehta' } },
    { type: 'update_lead', patch: { purpose: 'Home', budget: '5 crore' } },
  ]);

  it('builds valid drafts for every quick action, signed by the human advisor', () => {
    const bundle = currentBundle(content, state)!;
    expect(bundle.property.id).toBe(sale.property.id);
    const drafts = [
      summaryLinkDraft(state, ORIGIN),
      photoDraft(state, bundle, { label: 'Photo', url: 'https://demo.example.com/media/x.jpg' }),
      mapPinDraft(state, bundle),
      priceSheetDraft(content, state, bundle),
      recapDraft(),
      jiraFollowUpDraft(content, state, bundle),
      slackNotifyDraft(content, state, bundle, { score: 42, tier: 'Warm', stageLabel: 'Evaluating' }, ORIGIN),
    ];
    for (const d of drafts) expect(OutboundDraftSchema.safeParse(d).success).toBe(true);
    expect(drafts[0]!.text).toContain(`${ORIGIN}/call/s1/summary`);
    expect(drafts[0]!.text).toContain('Rahul, Agora Virtual Estates');
    expect(drafts[2]!.text).toContain('https://www.google.com/maps/search/?api=1&query=');
    expect(drafts[3]!.text).toContain('All-in price');
    expect(drafts[4]).toMatchObject({ channel: 'email', purpose: 'recap' });
    expect(drafts[5]).toMatchObject({ channel: 'jira', subject: `Follow up with Priya Sharma about ${sale.property.name}`, dueInDays: 1 });
    expect(drafts[5]!.text).toContain('looking for Home; budget 5 crore');
    expect(drafts[6]!.text).toContain(`${ORIGIN}/desk/call/s1`);
    expect(drafts[6]!.text).toContain('Rahul Mehta is with them now');
  });

  it('turns message next steps into drafts tied to the step, and leaves screen commands to the copilot', () => {
    const step = (action: ConsultNextStep['action']): ConsultNextStep => ({ id: 'n1', text: 'x', action, doneRef: null });
    expect(draftFromNextStep(step({ kind: 'jira', summary: 'Approval', dueInDays: 2 }))).toMatchObject({ channel: 'jira', subject: 'Approval', text: 'Approval', dueInDays: 2, purpose: 'action_item', nextStepId: 'n1' });
    expect(draftFromNextStep(step({ kind: 'email', subject: 'Plan', text: 'Attached' }))).toMatchObject({ channel: 'email', subject: 'Plan' });
    expect(draftFromNextStep(step({ kind: 'view', command: 'show the EMI' }))).toBeNull();
    expect(draftFromNextStep(step(null))).toBeNull();
  });
});

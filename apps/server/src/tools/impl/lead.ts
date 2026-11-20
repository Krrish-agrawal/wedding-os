import type { Delivery, LeadFields, ToolInput, ToolResult } from '@ave/shared';
import type { ToolContext } from '../context.js';
import { dispatch, fail, ok, stateOf } from '../kit.js';

const MAX_TEXT = 200;
const MAX_ITEMS = 10;
const DEFAULT_HANDOFF_REASON = 'Buyer would like to speak with a senior advisor';
/** How long sendReport waits for delivery results before answering "on its way". Below the MCP timeout. */
export const REPORT_WAIT_MS = 5000;

const clean = (s: string | undefined) => {
  const t = s?.trim().replace(/\s+/g, ' ').slice(0, MAX_TEXT);
  return t ? t : undefined;
};
const cleanList = (items: string[] | undefined) => {
  const out = (items ?? []).map(clean).filter((s): s is string => Boolean(s)).slice(0, MAX_ITEMS);
  return out.length ? out : undefined;
};

export function updateLead(tc: ToolContext, input: ToolInput<'updateLead'>): ToolResult {
  const patch: Partial<LeadFields> = {};
  const purpose = clean(input.purpose);
  const budget = clean(input.budget);
  const timeline = clean(input.timeline);
  if (purpose) patch.purpose = purpose;
  if (budget) patch.budget = budget;
  if (timeline) patch.timeline = timeline;
  for (const key of ['needs', 'concerns', 'objections', 'notes'] as const) {
    const list = cleanList(input[key]);
    if (list) patch[key] = list;
  }
  const recorded = Object.keys(patch);
  if (recorded.length === 0) return fail(tc, 'Nothing to record.', 'Call with at least one field filled in.', 'attentive');
  dispatch(tc, { type: 'update_lead', patch });
  return ok(tc, { recorded });
}

const DELIVERY_TEXT: Record<Delivery['status'], string> = {
  sent: 'sent',
  queued: 'on its way',
  failed: 'failed to send',
  not_configured: 'not set up on this demo',
};

export async function sendReport(tc: ToolContext, input: ToolInput<'sendReport'>): Promise<ToolResult> {
  const channels = [...new Set(input.channels)];
  const label = channels.map((c) => (c === 'email' ? 'email' : 'WhatsApp')).join(' and ');
  if (!input.confirmed) {
    return fail(tc, 'Sending the recap needs the buyer\'s agreement first.', `Ask whether they would like the recap by ${label}. Call again with confirmed true only after a yes.`, 'attentive');
  }
  const send = tc.deps.sendReport;
  if (!send) return fail(tc, 'The recap cannot be sent from here right now.', 'Apologise briefly and say a senior advisor will send it after the call.');

  // Delivery can take far longer than the engine waits for a tool (AI summary plus providers), so answer
  // within REPORT_WAIT_MS; anything still running carries on and the Outbox shows its real status.
  const sending = send(tc.app, tc.sessionId, channels);
  const waitMs = tc.deps.reportWaitMs ?? REPORT_WAIT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stillSending = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), waitMs);
  });
  let deliveries: Delivery[] | null;
  try {
    deliveries = await Promise.race([sending, stillSending]);
  } catch (err) {
    tc.log.error({ sessionId: tc.sessionId, err: (err as Error).message }, 'sendReport failed');
    return fail(tc, 'The recap could not be sent.', 'Apologise briefly and say a senior advisor will send it after the call.');
  } finally {
    clearTimeout(timer);
  }
  if (!deliveries) {
    sending.catch((err: unknown) => tc.log.error({ sessionId: tc.sessionId, err: (err as Error).message }, 'sendReport failed after the tool answered'));
    return ok(
      tc,
      { deliveries: channels.map((c) => ({ channel: c === 'email' ? 'email' : 'WhatsApp', status: DELIVERY_TEXT.queued })), guidance: 'Say it is on its way; the delivery status will show on the Lead Desk.' },
      input.tone ?? 'warm',
    );
  }

  const results = deliveries
    .filter((d) => d.channel === 'email' || d.channel === 'whatsapp')
    .map((d) => ({ channel: d.channel === 'email' ? 'email' : 'WhatsApp', status: DELIVERY_TEXT[d.status] }));
  const allGood = results.length > 0 && deliveries.every((d) => d.status === 'sent' || d.status === 'queued');
  return ok(
    tc,
    { deliveries: results, guidance: allGood ? 'Confirm it is on its way.' : 'Say exactly which channel worked and which did not; never claim a failed one was sent.' },
    input.tone ?? (allGood ? 'delighted' : 'apologetic'),
  );
}

export function requestHuman(tc: ToolContext, input: ToolInput<'requestHuman'>): ToolResult {
  const state = stateOf(tc);
  if (state.handoff.status === 'requested' || state.handoff.status === 'joined') {
    return ok(tc, { status: state.handoff.status, alreadyRequested: true }, input.tone ?? 'nod');
  }
  dispatch(tc, {
    type: 'set_handoff',
    patch: { status: 'requested', reason: clean(input.reason) ?? DEFAULT_HANDOFF_REASON, requestedAt: tc.deps.now() },
  });
  return ok(tc, { status: 'requested', guidance: 'Say in one line that a senior advisor is being connected, then keep helping until they join.' }, input.tone ?? 'nod');
}

import {
  callLiveSince,
  DELIVERY_CHANNELS,
  formatDateTimeIST,
  formatDuration,
  HANDOFF_TIMEOUT_NOTE_KIND,
  LEAD_STAGE_LABELS,
  leadStage,
  scoreLead,
  VIEW_LABELS,
  type CallLanguage,
  type Delivery,
  type DeliveryChannel,
  type DeliveryPurpose,
  type SessionAction,
  type SessionState,
} from '@ave/shared';
import type { Config } from '../config.js';
import type { SlackBlock } from './adapters/types.js';
import { toE164 } from './adapters/whatsapp.js';
import { istDateAfterDays, sendOutboundDraft, sendSlackPost, sendTracked, textToHtml } from './deliveries.js';
import type { RecapFacts } from './facts.js';
import { buildVisitIcs, ICS_CONTENT_TYPE, ICS_FILENAME } from './ics.js';
import { consultNotesText, openNextSteps, promisesNeedingApproval } from './notesText.js';
import { BRAND_NAME } from './render.js';
import { factsFor, syncCrm } from './reports.js';
import type { DeskRuntime } from './runtime.js';

/**
 * The automatic pipeline: fixed rules that send to WhatsApp, email, Slack, Jira and HubSpot when
 * something happens on a call (a visit booked, a human requested, nobody joining, the call ending).
 *
 * - Rules react to session store changes and run in the session's queue (`desk.enqueue`), so they
 *   never race the recap.
 * - Every send has a deterministic delivery id (`auto_<rule>_<channel>_<session>[_<subject>]`),
 *   checked against the session's deliveries first: a repeated event, a retry or a restart never
 *   sends twice, because deliveries are saved with the lead.
 * - `AUTOMATIONS` switches channels off without code changes; a switched-off channel is skipped
 *   and logged. A channel that is on but not set up is recorded as not_configured, never faked.
 * - The voice agent has no way to post to these tools: only these rules and the admin's confirmed
 *   previews send anything.
 */

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

const ID_PREFIX = 'auto';
/** Subjects become part of a delivery id; keep them short and safe. */
const SUBJECT_MAX_CHARS = 48;
const GOOGLE_MAPS_SEARCH_URL = 'https://www.google.com/maps/search/?api=1&query=';
/** The site-visit task is due this many days before the visit, so the team prepares in time. */
const VISIT_PREP_DAYS_BEFORE = 1;
/** The call-back task is due today. */
const CALLBACK_DUE_IN_DAYS = 0;
/** Follow-up tasks from the consult notes, when the notes give no due date. */
const ACTION_ITEM_DUE_IN_DAYS = 1;
/** A manager should decide on a promised discount or waiver quickly. */
const APPROVAL_DUE_IN_DAYS = 0;
/** Jira labels added next to JIRA_LABEL, so the team can filter by kind of task. */
const JIRA_EXTRA_LABELS = { visit: 'site-visit', callback: 'call-back', followUp: 'follow-up', approval: 'approval' } as const;
/** Slack limits: header text and section text. */
const SLACK_HEADER_MAX = 150;
const SLACK_SECTION_MAX = 2900;
/** Items listed per section in a Slack summary before "and N more". */
const SLACK_LIST_MAX = 5;

/** Channels named in AUTOMATIONS. Unknown names are reported, not guessed. */
export function parseAutomationChannels(raw: string): { channels: Set<DeliveryChannel>; unknown: string[] } {
  const names = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const valid = new Set<string>(DELIVERY_CHANNELS);
  return {
    channels: new Set(names.filter((n): n is DeliveryChannel => valid.has(n))),
    unknown: names.filter((n) => !valid.has(n)),
  };
}

/* ------------------------------------------------------------------ */
/* Links and small helpers                                             */
/* ------------------------------------------------------------------ */

export const leadUrl = (config: Config, sessionId: string) => `${config.WEB_ORIGIN}/desk?lead=${encodeURIComponent(sessionId)}`;
export const joinUrl = (config: Config, sessionId: string) => `${config.WEB_ORIGIN}/desk/call/${encodeURIComponent(sessionId)}?join=1`;
const mapsUrl = (loc: { lat: number; lng: number }) => `${GOOGLE_MAPS_SEARCH_URL}${loc.lat},${loc.lng}`;

/** Slack mrkdwn needs &, < and > escaped; everything else is shown as typed. */
function mrkdwn(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function safeSubject(s: string): string {
  return s.replace(/[^A-Za-z0-9-]+/g, '-').slice(0, SUBJECT_MAX_CHARS);
}

/** The moment the current handoff request began: the subject of the handoff rules. */
function lastHandoffRequestAt(state: SessionState): number | null {
  for (let i = state.timeline.length - 1; i >= 0; i--) {
    const e = state.timeline[i];
    if (e?.kind === 'handoff_requested') return e.at;
  }
  return state.handoff.requestedAt;
}

const header = (text: string): SlackBlock => ({ type: 'header', text: { type: 'plain_text', text: clip(text, SLACK_HEADER_MAX), emoji: false } });
const section = (text: string): SlackBlock => ({ type: 'section', text: { type: 'mrkdwn', text: clip(text, SLACK_SECTION_MAX) } });
const fields = (pairs: [string, string][]): SlackBlock => ({ type: 'section', fields: pairs.map(([k, v]) => ({ type: 'mrkdwn', text: `*${mrkdwn(k)}*\n${mrkdwn(v)}` })) });
const context = (text: string): SlackBlock => ({ type: 'context', elements: [{ type: 'mrkdwn', text: clip(text, SLACK_SECTION_MAX) }] });
const button = (text: string, url: string, primary = false): SlackBlock => ({
  type: 'button',
  text: { type: 'plain_text', text, emoji: false },
  url,
  ...(primary ? { style: 'primary' } : {}),
});
const actions = (...buttons: SlackBlock[]): SlackBlock => ({ type: 'actions', elements: buttons });

function bulletList(items: string[]): string {
  const shown = items.slice(0, SLACK_LIST_MAX).map((i) => `• ${mrkdwn(i)}`);
  if (items.length > SLACK_LIST_MAX) shown.push(`_and ${items.length - SLACK_LIST_MAX} more_`);
  return shown.join('\n');
}

/** Score, tier and stage, as the Lead Desk shows them. */
function leadStanding(desk: DeskRuntime, state: SessionState): string {
  const { scoring } = desk.ctx.content;
  const score = scoreLead(state, scoring, desk.deps.now());
  return `Score ${score.score} · ${score.tier} · ${LEAD_STAGE_LABELS[leadStage(state)]}`;
}

/** Three lines on where the call stands, for the people about to join it. */
export function handoffBrief(desk: DeskRuntime, state: SessionState): string[] {
  const bundle = state.propertyId ? desk.ctx.content.byId[state.propertyId] : undefined;
  const known = [
    state.lead.purpose && `looking for ${state.lead.purpose}`,
    state.lead.budget && `budget ${state.lead.budget}`,
    state.lead.timeline && `timeline ${state.lead.timeline}`,
  ].filter((s): s is string => Boolean(s));
  return [
    `On screen: ${bundle ? `${bundle.property.name}, ` : ''}${VIEW_LABELS[state.view]}`,
    known.length ? `Buyer is ${known.join('; ')}` : 'Purpose, budget and timeline not recorded yet',
    state.lead.objections.length ? `Objections: ${state.lead.objections.join('; ')}` : 'No objections raised yet',
  ];
}

/* ------------------------------------------------------------------ */
/* Rule context: switches and idempotency                              */
/* ------------------------------------------------------------------ */

export interface RuleRun {
  desk: DeskRuntime;
  sessionId: string;
  /** What the rule is about inside the session (a slot, a handoff request); '' for once per call. */
  subject: string;
  /** Freshest state, read when the rule starts. */
  state: SessionState;
  facts: RecapFacts;
  /**
   * Runs one send unless its channel is switched off or a delivery with the same id exists.
   * `part` tells apart several sends on one channel (one Jira task per next step).
   */
  once(channel: DeliveryChannel, part: string | null, send: (id: string) => Promise<Delivery | null>): Promise<Delivery | null>;
}

export interface AutomationRule {
  id: string;
  purpose: DeliveryPurpose;
  /** For the docs and the Integrations page; `once` enforces the switch per send. */
  channels: readonly DeliveryChannel[];
  /** The subject when this change should run the rule, or null when it should not. */
  when(state: SessionState, action: SessionAction): string | null;
  run(r: RuleRun): Promise<void>;
}

/* ------------------------------------------------------------------ */
/* Visit booked                                                        */
/* ------------------------------------------------------------------ */

async function visitBooked(r: RuleRun): Promise<void> {
  const { desk, sessionId, state, facts } = r;
  const visit = facts.visit;
  const bundle = visit ? desk.ctx.content.byId[visit.propertyId] : undefined;
  if (!visit || !bundle) {
    desk.log.warn({ sessionId }, 'visit booked but the slot is not in /data; nothing sent');
    return;
  }
  const { config } = desk.ctx;
  const map = mapsUrl(bundle.property.location);
  const when = `${visit.date}, ${visit.time}`;
  const shortWhen = formatDateTimeIST(visit.start);
  const purpose: DeliveryPurpose = 'visit_confirmed';

  const whatsapp = () =>
    r.once('whatsapp', null, (id) =>
      sendOutboundDraft(
        desk,
        sessionId,
        {
          channel: 'whatsapp',
          subject: null,
          text: [
            `Hi ${facts.buyer.firstName}, your site visit is confirmed.`,
            '',
            `*${visit.propertyName}*`,
            when,
            visit.address,
            `Map: ${map}`,
            '',
            `Booked on your call with ${facts.advisorName}, ${BRAND_NAME}.`,
          ].join('\n'),
          mediaUrl: null,
          dueInDays: null,
          purpose,
          nextStepId: null,
        },
        { id, label: 'Visit confirmation' },
      ),
    );

  const email = () =>
    r.once('email', null, (id) => {
      const subject = `Site visit confirmed: ${visit.propertyName}, ${visit.date}`;
      const text = [
        `Hi ${facts.buyer.firstName},`,
        '',
        `Your site visit to ${visit.propertyName} is booked for ${when}.`,
        `Address: ${visit.address}`,
        `Map: ${map}`,
        '',
        'The calendar invite is attached.',
        '',
        `${facts.advisorName}, ${BRAND_NAME}`,
      ].join('\n');
      const html = textToHtml(text);
      const ics = buildVisitIcs({ sessionId, visit, description: `Site visit booked on your call with ${facts.advisorName}. Map: ${map}`, now: new Date(desk.deps.now()) });
      return sendTracked(desk, sessionId, { channel: 'email', to: state.buyer.email, purpose, label: 'Visit invite', id, preview: { subject, text, html } }, () =>
        desk.deps.email.send({
          to: state.buyer.email,
          subject,
          html,
          text,
          attachments: [{ filename: ICS_FILENAME, contentType: ICS_CONTENT_TYPE, content: ics }],
          idempotencyKey: id,
        }),
      );
    });

  const slack = () =>
    r.once('slack', null, (id) =>
      sendSlackPost(
        desk,
        sessionId,
        {
          text: `Site visit booked: ${state.buyer.name} at ${visit.propertyName}, ${shortWhen}`,
          blocks: [
            header('Site visit booked'),
            fields([
              ['Buyer', state.buyer.name],
              ['Property', `${visit.propertyName} (${bundle.property.configuration})`],
              ['Visit', when],
              ['Lead', leadStanding(desk, state)],
            ]),
            context(`${mrkdwn(visit.address)} · <${map}|Map>`),
            actions(button('Open in Lead Desk', leadUrl(config, sessionId), true)),
          ],
          // Already a thread (a handoff came first): show the card in the channel too.
          broadcast: true,
        },
        { purpose, label: 'Visit card', id },
      ),
    );

  const jira = () =>
    r.once('jira', null, (id) => {
      const dayBefore = istDateAfterDays(Date.parse(visit.start), -VISIT_PREP_DAYS_BEFORE);
      const today = istDateAfterDays(desk.deps.now(), 0);
      const summary = `Prepare site visit: ${visit.propertyName}, ${shortWhen} (${state.buyer.name})`;
      const description = [
        `Site visit booked on a call with ${facts.advisorName}.`,
        '',
        `Buyer: ${state.buyer.name}, ${toE164(state.buyer.phone) ?? state.buyer.phone}, ${state.buyer.email}`,
        `Property: ${visit.propertyName}, ${visit.address}`,
        `When: ${when}`,
        `Map: ${map}`,
        `Lead: ${leadUrl(config, sessionId)}`,
        ...(state.lead.needs.length ? ['', `Must-haves: ${state.lead.needs.join(', ')}`] : []),
        ...(state.lead.concerns.length ? [`Concerns: ${state.lead.concerns.join('; ')}`] : []),
      ].join('\n');
      return createJiraTask(r, id, { summary, description, dueDate: dayBefore < today ? today : dayBefore, labels: [JIRA_EXTRA_LABELS.visit], purpose, label: 'Site visit task' });
    });

  const crm = () =>
    desk.deps.crm
      ? r.once('crm', null, (id) =>
          syncCrm(desk, sessionId, {
            id,
            purpose,
            label: 'Deal at visit booked',
            note: [`Site visit booked on a call with ${facts.advisorName}.`, `${visit.propertyName}, ${when}`, visit.address].join('\n'),
          }),
        )
      : Promise.resolve(null);

  // Independent of one another, so they go out together: the demo shows them landing at once.
  await Promise.all([whatsapp(), slack(), jira(), email(), crm()]);
}

/* ------------------------------------------------------------------ */
/* Human requested, and nobody joined                                  */
/* ------------------------------------------------------------------ */

async function handoffRequested(r: RuleRun): Promise<void> {
  const { desk, sessionId, state } = r;
  const { config } = desk.ctx;
  const reason = state.handoff.reason ?? 'No reason given';
  const brief = handoffBrief(desk, state);
  await r.once('slack', null, (id) =>
    sendSlackPost(
      desk,
      sessionId,
      {
        text: `${state.buyer.name} wants to talk to a person: ${reason}`,
        blocks: [
          header(`${state.buyer.name} wants to talk to a person`),
          section(`*Reason:* ${mrkdwn(reason)}`),
          section(brief.map(mrkdwn).join('\n')),
          context(leadStanding(desk, state)),
          actions(button('Join call', joinUrl(config, sessionId), true), button('Open in Lead Desk', leadUrl(config, sessionId))),
        ],
        broadcast: true,
      },
      { purpose: 'handoff_alert', label: 'Handoff alert', id },
    ),
  );
}

/** Short call-back promise to the buyer, in the call's language. */
const CALLBACK_WHATSAPP: Record<CallLanguage, (firstName: string) => string> = {
  en: (n) => `Hi ${n}, sorry nobody from our team could join the call just now. We will call you back shortly on this number. ${BRAND_NAME}`,
  hi: (n) => `नमस्ते ${n}, माफ़ कीजिए, अभी हमारी टीम से कोई कॉल पर नहीं जुड़ पाया। हम जल्द ही आपको इसी नंबर पर वापस कॉल करेंगे। ${BRAND_NAME}`,
  kn: (n) => `ನಮಸ್ಕಾರ ${n}, ಕ್ಷಮಿಸಿ, ಈಗ ನಮ್ಮ ತಂಡದಿಂದ ಯಾರೂ ಕರೆಗೆ ಸೇರಲು ಆಗಲಿಲ್ಲ. ಶೀಘ್ರದಲ್ಲೇ ನಾವು ಇದೇ ಸಂಖ್ಯೆಗೆ ಕರೆ ಮಾಡುತ್ತೇವೆ. ${BRAND_NAME}`,
};

export function callbackWhatsApp(language: CallLanguage, firstName: string): string {
  return (CALLBACK_WHATSAPP[language] ?? CALLBACK_WHATSAPP.en)(firstName);
}

async function handoffTimedOut(r: RuleRun): Promise<void> {
  const { desk, sessionId, state, facts } = r;
  const { config } = desk.ctx;
  const purpose: DeliveryPurpose = 'handoff_timeout';
  const phone = toE164(state.buyer.phone) ?? state.buyer.phone;
  const reason = state.handoff.reason ?? 'No reason given';
  const waitedSeconds = Math.round(config.HANDOFF_TIMEOUT_MS / 1000);

  // The task first, so the Slack escalation can link to it.
  const task = await r.once('jira', null, (id) =>
    createJiraTask(r, id, {
      summary: `Call back ${state.buyer.name}`,
      description: [
        `${state.buyer.name} asked for a person and nobody joined within ${waitedSeconds} s. The buyer was told the team will call back.`,
        '',
        `Phone: ${phone}`,
        `Reason: ${reason}`,
        ...handoffBrief(desk, state),
        `Lead: ${leadUrl(config, sessionId)}`,
      ].join('\n'),
      dueDate: istDateAfterDays(desk.deps.now(), CALLBACK_DUE_IN_DAYS),
      labels: [JIRA_EXTRA_LABELS.callback],
      purpose,
      label: 'Call-back task',
    }),
  );
  const taskLine = task?.status === 'sent' && task.ref ? (task.url ? `<${task.url}|${task.ref}>` : task.ref) : null;

  await Promise.all([
    r.once('slack', null, (id) =>
      sendSlackPost(
        desk,
        sessionId,
        {
          text: `Nobody joined ${state.buyer.name}'s call within ${waitedSeconds} s. Call back ${phone}.`,
          blocks: [
            header(`Nobody joined ${state.buyer.name}'s call`),
            section(
              [`The buyer waited ${waitedSeconds} s and was told the team will call back.`, `*Call back:* ${mrkdwn(phone)}`, `*Reason:* ${mrkdwn(reason)}`, ...(taskLine ? [`*Task:* ${taskLine}`] : [])].join('\n'),
            ),
            actions(button('Open in Lead Desk', leadUrl(config, sessionId), true)),
          ],
          broadcast: true,
        },
        { purpose, label: 'Escalation', id },
      ),
    ),
    r.once('whatsapp', null, (id) =>
      sendOutboundDraft(
        desk,
        sessionId,
        { channel: 'whatsapp', subject: null, text: callbackWhatsApp(state.language, facts.buyer.firstName), mediaUrl: null, dueInDays: null, purpose, nextStepId: null },
        { id, label: 'Call-back message' },
      ),
    ),
  ]);
}

/* ------------------------------------------------------------------ */
/* Call ended                                                          */
/* ------------------------------------------------------------------ */

/** The Slack summary text: what was covered, what was agreed, what is still open. */
export function callSummaryText(desk: DeskRuntime, state: SessionState, facts: RecapFacts): { headline: string; body: string } {
  const live = callLiveSince(state);
  const length = live !== null ? ` (${formatDuration(desk.deps.now() - live)})` : '';
  const headline = `Call ended: ${state.buyer.name}${length}`;
  const lines: string[] = [];
  if (facts.properties.length) lines.push(`*Saw:* ${mrkdwn(facts.properties.map((p) => `${p.name} (${p.headline.value})`).join('; '))}`);
  if (facts.visit) lines.push(`*Visit:* ${mrkdwn(`${facts.visit.propertyName}, ${facts.visit.date}, ${facts.visit.time}`)}`);
  if (facts.humanAdvisor) lines.push(`*Advisor joined:* ${mrkdwn(facts.humanAdvisor)}`);
  const notes = state.consult.notes;
  if (notes?.summary.trim()) lines.push(`*Consult:* ${mrkdwn(notes.summary.trim())}`);
  const approvals = promisesNeedingApproval(notes).map((p) => p.text);
  if (approvals.length) lines.push(`*Needs approval:*\n${bulletList(approvals)}`);
  const asks = notes?.buyerAsks.map((a) => a.text) ?? [];
  if (asks.length) lines.push(`*Open asks:*\n${bulletList(asks)}`);
  const steps = openNextSteps(notes).map((s) => s.text);
  if (steps.length) lines.push(`*Next steps:*\n${bulletList(steps)}`);
  if (!lines.length) lines.push('Nothing was recorded on this call.');
  return { headline, body: lines.join('\n') };
}

async function callEnded(r: RuleRun): Promise<void> {
  const { desk, sessionId, state, facts } = r;
  const { headline, body } = callSummaryText(desk, state, facts);
  await r.once('slack', null, (id) =>
    sendSlackPost(
      desk,
      sessionId,
      {
        // Plain-text fallback without the mrkdwn markers.
        text: `${headline}\n${body.replace(/\*/g, '')}`,
        blocks: [header(headline), section(body), context(leadStanding(desk, state)), actions(button('Open in Lead Desk', leadUrl(desk.ctx.config, sessionId), true))],
      },
      { purpose: 'call_summary', label: 'Call summary', id },
    ),
  );
}

/**
 * One Jira task per open next step from the consult notes, and one approval task per promise
 * that needs a manager. Runs at call end and again if the notes change after it (the final
 * notes can land a moment later); item ids keep it from creating a task twice.
 */
async function callTasks(r: RuleRun): Promise<void> {
  const { desk, sessionId, state } = r;
  const notes = state.consult.notes;
  if (!notes) return;
  const lead = leadUrl(desk.ctx.config, sessionId);
  const purpose: DeliveryPurpose = 'action_item';
  for (const step of openNextSteps(notes)) {
    const jiraAction = step.action?.kind === 'jira' ? step.action : null;
    await r.once('jira', safeSubject(`step-${step.id}`), (id) =>
      createJiraTask(r, id, {
        summary: jiraAction?.summary ?? step.text,
        description: [jiraAction?.description ?? step.text, '', `Buyer: ${state.buyer.name}`, `Lead: ${lead}`].join('\n'),
        dueDate: istDateAfterDays(desk.deps.now(), jiraAction?.dueInDays ?? ACTION_ITEM_DUE_IN_DAYS),
        labels: [JIRA_EXTRA_LABELS.followUp],
        purpose,
        label: 'Follow-up task',
      }),
    );
  }
  for (const promise of promisesNeedingApproval(notes)) {
    await r.once('jira', safeSubject(`approval-${promise.id}`), (id) =>
      createJiraTask(r, id, {
        summary: `Approval: ${promise.text}`,
        description: [
          `${state.handoff.humanName ?? 'The advisor'} told ${state.buyer.name} this on the call; it needs a manager's approval before anyone acts on it.`,
          ...(promise.quote ? ['', `"${promise.quote}"`] : []),
          '',
          `Lead: ${lead}`,
        ].join('\n'),
        dueDate: istDateAfterDays(desk.deps.now(), APPROVAL_DUE_IN_DAYS),
        labels: [JIRA_EXTRA_LABELS.approval],
        purpose,
        label: 'Approval task',
      }),
    );
  }
}

/** Creates a Jira issue, recorded as a delivery with its summary and description as the preview. */
function createJiraTask(
  r: RuleRun,
  id: string,
  t: { summary: string; description: string; dueDate: string | null; labels: string[]; purpose: DeliveryPurpose; label: string },
): Promise<Delivery | null> {
  const { desk, sessionId } = r;
  return sendTracked(
    desk,
    sessionId,
    { channel: 'jira', to: desk.deps.jira.destination, purpose: t.purpose, label: t.label, id, preview: { subject: t.summary, text: t.description, html: null } },
    () => desk.deps.jira.createIssue({ summary: t.summary, description: t.description, dueDate: t.dueDate, labels: t.labels }),
  );
}

/* ------------------------------------------------------------------ */
/* The rules table                                                     */
/* ------------------------------------------------------------------ */

export const AUTOMATION_RULES: readonly AutomationRule[] = [
  {
    id: 'visit_booked',
    purpose: 'visit_confirmed',
    channels: ['whatsapp', 'email', 'slack', 'jira', 'crm'],
    when: (_s, a) => (a.type === 'confirm_booking' ? safeSubject(`${a.propertyId}-${a.slotId}`) : null),
    run: visitBooked,
  },
  {
    id: 'handoff_requested',
    purpose: 'handoff_alert',
    channels: ['slack'],
    when: (s, a) => (a.type === 'set_handoff' && a.patch.status === 'requested' && s.handoff.status === 'requested' ? String(lastHandoffRequestAt(s) ?? '') : null),
    run: handoffRequested,
  },
  {
    id: 'handoff_timeout',
    purpose: 'handoff_timeout',
    channels: ['jira', 'slack', 'whatsapp'],
    when: (s, a) => (a.type === 'note' && a.kind === HANDOFF_TIMEOUT_NOTE_KIND ? String(lastHandoffRequestAt(s) ?? '') : null),
    run: handoffTimedOut,
  },
  {
    id: 'call_ended',
    purpose: 'call_summary',
    channels: ['slack'],
    when: (s, a) => (a.type === 'set_status' && s.status === 'ended' ? '' : null),
    run: callEnded,
  },
  {
    id: 'call_tasks',
    purpose: 'action_item',
    channels: ['jira'],
    when: (s, a) => (s.status === 'ended' && (a.type === 'set_status' || a.type === 'set_consult') ? '' : null),
    run: callTasks,
  },
];

/* ------------------------------------------------------------------ */
/* Runner                                                              */
/* ------------------------------------------------------------------ */

export function automationDeliveryId(ruleId: string, channel: DeliveryChannel, sessionId: string, subject: string, part: string | null): string {
  return [ID_PREFIX, ruleId, channel, ...(part ? [part] : []), sessionId, ...(subject ? [subject] : [])].join('_');
}

/** Runs one rule now (the caller is already inside the session's queue). Never rejects. */
export async function runRule(desk: DeskRuntime, rule: AutomationRule, sessionId: string, subject: string, enabled: ReadonlySet<DeliveryChannel>): Promise<void> {
  const state = desk.getState(sessionId);
  if (!state) return;
  const run: RuleRun = {
    desk,
    sessionId,
    subject,
    state,
    facts: factsFor(desk, state),
    async once(channel, part, send) {
      if (!enabled.has(channel)) {
        desk.log.info({ sessionId, rule: rule.id, channel }, 'automation skipped: channel switched off in AUTOMATIONS');
        return null;
      }
      const id = automationDeliveryId(rule.id, channel, sessionId, subject, part);
      const existing = desk.getState(sessionId)?.deliveries.find((d) => d.id === id);
      if (existing) return existing;
      return send(id);
    },
  };
  try {
    await rule.run(run);
  } catch (err) {
    desk.log.error({ sessionId, rule: rule.id, err: (err as Error).message }, 'automation failed unexpectedly');
  }
}

/**
 * Starts the automatic pipeline for a Desk runtime: watches the live session store and queues
 * matching rules. Returns a function that stops watching.
 */
export function startAutomations(desk: DeskRuntime, rules: readonly AutomationRule[] = AUTOMATION_RULES): () => void {
  const { channels: enabled, unknown } = parseAutomationChannels(desk.ctx.config.AUTOMATIONS);
  if (unknown.length) desk.log.warn({ unknown }, 'AUTOMATIONS names channels that do not exist; they are ignored');
  desk.log.info({ channels: [...enabled] }, 'automations ready');

  const onChange = (state: SessionState, action: SessionAction) => {
    for (const rule of rules) {
      const subject = rule.when(state, action);
      if (subject === null) continue;
      void desk.enqueue(state.id, () => runRule(desk, rule, state.id, subject, enabled));
    }
  };
  desk.ctx.store.on('change', onChange);
  return () => desk.ctx.store.off('change', onChange);
}

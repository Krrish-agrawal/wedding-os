import { Building2, Hash, Mail, MessageCircle, SquareCheckBig, type LucideIcon } from 'lucide-react';
import { formatDateTimeIST, type Delivery, type DeliveryPurpose, type LeadStage, type SessionSummary } from '@ave/shared';
import type { PillTone } from '@/ui';
import type { Accent } from '@/views/types';

/** Presentation rules for the Lead Desk: tones, labels and relative times. */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const JUST_NOW_MS = 45_000;

/** "just now", "4 min ago", "2 h ago", then a date. */
export function formatAgo(at: number, now: number): string {
  const d = Math.max(0, now - at);
  if (d < JUST_NOW_MS) return 'just now';
  if (d < HOUR_MS) return `${Math.max(1, Math.round(d / MINUTE_MS))} min ago`;
  if (d < DAY_MS) return `${Math.round(d / HOUR_MS)} h ago`;
  return formatDateTimeIST(at);
}

/** Tier colour by rank: the hottest tier gets the alert accent, the coldest stays quiet. */
export function tierTone(rank: number, count: number): PillTone {
  if (count <= 1) return 'neutral';
  if (rank >= count - 1) return 'error';
  if (rank === 0) return 'blue';
  return 'waiting';
}

export const STAGE_ACCENT: Record<LeadStage, Accent | null> = {
  new: null,
  exploring: 'blue',
  evaluating: 'sun',
  negotiating: 'coral',
  visit_booked: 'mint',
};

export const CHANNEL_ICON: Record<Delivery['channel'], LucideIcon> = {
  email: Mail,
  whatsapp: MessageCircle,
  crm: Building2,
  slack: Hash,
  jira: SquareCheckBig,
};

export const CHANNEL_NAME: Record<Delivery['channel'], string> = {
  email: 'Email',
  whatsapp: 'WhatsApp',
  crm: 'CRM',
  slack: 'Slack',
  jira: 'Jira',
};

/** Honest status words: "Sent" only when the provider accepted it. */
export const DELIVERY_STATUS: Record<Delivery['status'], { label: string; tone: PillTone }> = {
  queued: { label: 'Sending', tone: 'waiting' },
  sent: { label: 'Sent', tone: 'live' },
  failed: { label: 'Failed', tone: 'error' },
  not_configured: { label: 'Not configured', tone: 'muted' },
};

/** What the AI advisor is doing on a live call, as the desk should read it. */
export function callStatus(s: Pick<SessionSummary, 'status' | 'handoff' | 'agentStatus'>): { label: string; tone: PillTone } {
  if (s.status === 'ringing') return { label: 'Ringing', tone: 'waiting' };
  if (s.handoff === 'requested') return { label: 'Wants a human', tone: 'error' };
  if (s.handoff === 'joined') return { label: 'Advisor on call', tone: 'neutral' };
  switch (s.agentStatus) {
    case 'live':
      return { label: 'AI on call', tone: 'live' };
    case 'starting':
      return { label: 'AI joining', tone: 'waiting' };
    case 'standby':
      return { label: 'AI standing by', tone: 'muted' };
    case 'error':
      return { label: 'AI reconnecting', tone: 'waiting' };
    case 'off':
      return { label: 'AI not connected', tone: 'muted' };
  }
}

export const SOURCE_LABEL: Record<string, string> = {
  agent: 'AI',
  buyer: 'Buyer',
  advisor: 'Advisor',
  presenter: 'Presenter',
  system: 'System',
};

/** Why something was sent, as the Outbox and Integrations page name it. */
export const PURPOSE_LABEL: Record<DeliveryPurpose, string> = {
  recap: 'Recap',
  visit_confirmed: 'Visit booked',
  handoff_alert: 'Handoff alert',
  handoff_timeout: 'Nobody joined',
  call_summary: 'Call summary',
  action_item: 'Action item',
  manual: 'Sent by hand',
  test: 'Test',
};

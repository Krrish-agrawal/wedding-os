/**
 * Outcome of one delivery attempt. "sent" means the provider accepted the message,
 * never that we assumed it would.
 */
export type SendOutcome =
  | { status: 'sent'; providerId: string | null; detail: string; url?: string | null }
  | { status: 'failed'; detail: string }
  | { status: 'not_configured'; detail: string };

export interface EmailAttachment {
  filename: string;
  /** UTF-8 text content; adapters encode it as their provider requires. */
  content: string;
  contentType: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments: EmailAttachment[];
  /** Stable key so a retried request is not delivered twice. */
  idempotencyKey: string;
}

export interface EmailAdapter {
  readonly provider: string;
  send(message: EmailMessage): Promise<SendOutcome>;
}

export interface WhatsAppMessage {
  /** E.164, e.g. +919876543210. */
  to: string;
  body: string;
  /** Public image URL sent with the text (Twilio MediaUrl, Meta image.link). */
  mediaUrl?: string | null;
}

export interface WhatsAppAdapter {
  readonly provider: string;
  send(message: WhatsAppMessage): Promise<SendOutcome>;
}

export interface CrmLead {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  dealName: string;
  /** Rupees, when a sale price is known. */
  amount: number | null;
  visitBooked: boolean;
  /** Plain-text recap attached to the deal and contact as a note. */
  note: string;
  /** Existing deal from an earlier sync, updated instead of duplicated. */
  dealId: string | null;
}

export type CrmOutcome =
  | { status: 'sent'; contactId: string; dealId: string; noteId: string; detail: string }
  | { status: 'failed'; detail: string };

export interface CrmAdapter {
  readonly provider: string;
  syncLead(lead: CrmLead): Promise<CrmOutcome>;
}

/** A Block Kit block, passed through to Slack as-is. */
export type SlackBlock = Record<string, unknown>;

export interface SlackMessage {
  /** Plain-text fallback, also used for notifications. */
  text: string;
  blocks?: SlackBlock[];
  /** Reply in this thread (the ts of an earlier message), when the adapter supports threads. */
  threadTs?: string | null;
  /** Also show a thread reply in the channel (reply_broadcast), for alerts the whole team must see. */
  broadcast?: boolean;
}

export interface SlackAdapter {
  readonly provider: string;
  /** Channel name or id shown to the admin as the recipient, e.g. "#sales-pipeline". */
  readonly destination: string;
  /** `providerId` is the message ts when the provider returns one (bot token), else null (webhook). */
  send(message: SlackMessage): Promise<SendOutcome>;
}

export interface JiraIssue {
  summary: string;
  /** Plain text; the adapter converts it to Atlassian Document Format. */
  description: string;
  /** YYYY-MM-DD in IST, or null for no due date. */
  dueDate: string | null;
  labels?: string[];
}

export interface JiraAdapter {
  readonly provider: string;
  /** Project shown to the admin as the recipient, e.g. "Jira AVE". */
  readonly destination: string;
  /** `providerId` is the issue key and `url` the browse link when created. */
  createIssue(issue: JiraIssue): Promise<SendOutcome>;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

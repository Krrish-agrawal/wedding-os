import type { Config } from '../../config.js';
import { field, requestJson, short } from './http.js';
import type { FetchLike, JiraAdapter, JiraIssue, SendOutcome } from './types.js';

/** Jira Cloud rejects longer summaries. */
export const JIRA_SUMMARY_MAX = 255;
const HTTP_BAD_REQUEST = 400;
/**
 * Fields some project templates leave off the create screen (team-managed projects often have no
 * due date). Jira then refuses the whole issue, so we retry once without them and say so.
 */
const DROPPABLE_FIELDS = ['duedate', 'labels'] as const;
type DroppableField = (typeof DROPPABLE_FIELDS)[number];
const FIELD_NAMES: Record<DroppableField, string> = { duedate: 'due date', labels: 'labels' };

/* ------------------------------------------------------------------ */
/* Atlassian Document Format                                           */
/* ------------------------------------------------------------------ */

type AdfText = { type: 'text'; text: string; marks?: { type: 'link'; attrs: { href: string } }[] };
type AdfInline = AdfText | { type: 'hardBreak' };
export interface AdfDoc {
  type: 'doc';
  version: 1;
  content: { type: 'paragraph'; content: AdfInline[] }[];
}

const URL_PATTERN = /https?:\/\/[^\s<>"]+/g;
/** Punctuation that ends a sentence rather than a URL. */
const TRAILING_PUNCTUATION = /[).,;:!?]+$/;

/** One line as text nodes, with every URL kept as text and marked as a link. */
function inlineWithLinks(line: string): AdfText[] {
  const out: AdfText[] = [];
  let last = 0;
  for (const match of line.matchAll(URL_PATTERN)) {
    const url = match[0].replace(TRAILING_PUNCTUATION, '');
    const start = match.index;
    if (start > last) out.push({ type: 'text', text: line.slice(last, start) });
    out.push({ type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url } }] });
    last = start + url.length;
  }
  if (last < line.length) out.push({ type: 'text', text: line.slice(last) });
  return out;
}

/**
 * Plain text to ADF: a paragraph per blank-line block, a hard break per line inside it.
 * ADF forbids empty text nodes, so blank lines never become nodes.
 */
export function textToAdf(text: string): AdfDoc {
  const blocks = text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((b) => b.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim().length > 0))
    .filter((lines) => lines.length > 0);
  return {
    type: 'doc',
    version: 1,
    content: blocks.map((lines) => ({
      type: 'paragraph',
      content: lines.flatMap((line, i): AdfInline[] => (i === 0 ? inlineWithLinks(line) : [{ type: 'hardBreak' }, ...inlineWithLinks(line)])),
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Adapter                                                             */
/* ------------------------------------------------------------------ */

/** Jira summaries are one line of at most 255 characters. */
export function jiraSummary(s: string): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > JIRA_SUMMARY_MAX ? `${one.slice(0, JIRA_SUMMARY_MAX - 1)}…` : one;
}

/** Jira labels cannot contain spaces. */
function jiraLabel(s: string): string {
  return s.trim().replace(/\s+/g, '-');
}

/** Readable reason from Jira's `{ errorMessages: [], errors: { field: message } }` body. */
function jiraErrorDetail(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null;
  const o = json as { errorMessages?: unknown; errors?: unknown };
  const parts: string[] = [];
  if (Array.isArray(o.errorMessages)) parts.push(...o.errorMessages.filter((m): m is string => typeof m === 'string'));
  if (o.errors && typeof o.errors === 'object') {
    for (const [key, msg] of Object.entries(o.errors as Record<string, unknown>)) if (typeof msg === 'string') parts.push(`${key}: ${msg}`);
  }
  return parts.length ? short(parts.join('; ')) : null;
}

/** Which of the optional fields Jira complained about, by field key or in its messages. */
function rejectedFields(json: unknown): DroppableField[] {
  if (!json || typeof json !== 'object') return [];
  const o = json as { errors?: unknown; errorMessages?: unknown };
  const keys = o.errors && typeof o.errors === 'object' ? Object.keys(o.errors) : [];
  const messages = Array.isArray(o.errorMessages) ? o.errorMessages.filter((m): m is string => typeof m === 'string').join(' ') : '';
  return DROPPABLE_FIELDS.filter((f) => keys.includes(f) || messages.includes(`'${f}'`));
}

/** Jira Cloud REST v3 with Basic auth (Atlassian account email and API token). */
export class JiraCloudAdapter implements JiraAdapter {
  readonly provider = 'Jira Cloud';
  readonly destination: string;
  private readonly base: string;

  constructor(
    baseUrl: string,
    private readonly email: string,
    private readonly apiToken: string,
    private readonly projectKey: string,
    private readonly issueType: string,
    private readonly label: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    this.base = baseUrl.replace(/\/+$/, '');
    this.destination = `Jira ${projectKey}`;
  }

  private post(fields: Record<string, unknown>) {
    const auth = Buffer.from(`${this.email}:${this.apiToken}`).toString('base64');
    return requestJson(this.fetchImpl, `${this.base}/rest/api/3/issue`, {
      method: 'POST',
      headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ fields }),
    });
  }

  async createIssue(issue: JiraIssue): Promise<SendOutcome> {
    const labels = [...new Set([this.label, ...(issue.labels ?? [])].map(jiraLabel).filter(Boolean))];
    const fields: Record<string, unknown> = {
      project: { key: this.projectKey },
      summary: jiraSummary(issue.summary),
      issuetype: { name: this.issueType },
      ...(issue.description.trim() ? { description: textToAdf(issue.description) } : {}),
      ...(labels.length ? { labels } : {}),
      ...(issue.dueDate ? { duedate: issue.dueDate } : {}),
    };

    let res = await this.post(fields);
    let dropped: DroppableField[] = [];
    if (!res.ok && res.status === HTTP_BAD_REQUEST) {
      dropped = rejectedFields(res.json).filter((f) => f in fields);
      if (dropped.length) {
        const retry = { ...fields };
        for (const f of dropped) delete retry[f];
        res = await this.post(retry);
      }
    }
    if (!res.ok) {
      const jiraReason = jiraErrorDetail(res.json);
      const reason = jiraReason && res.status ? `HTTP ${res.status}: ${jiraReason}` : res.reason;
      return { status: 'failed', detail: `Jira did not create the issue (${reason})` };
    }
    const key = field(res.json, 'key');
    if (!key) return { status: 'failed', detail: 'Jira answered without an issue key' };
    const note = dropped.length ? ` without ${dropped.map((f) => FIELD_NAMES[f]).join(' and ')} (not on the project's create screen)` : '';
    return { status: 'sent', providerId: key, detail: `Created ${key} in ${this.destination}${note}`, url: `${this.base}/browse/${key}` };
  }
}

/** Stands in for Jira when it is not set up. */
export class UnconfiguredJiraAdapter implements JiraAdapter {
  readonly provider = 'none';
  readonly destination = 'Jira';
  constructor(private readonly reason: string) {}
  async createIssue(): Promise<SendOutcome> {
    return { status: 'not_configured', detail: this.reason };
  }
}

export function createJiraAdapter(config: Config, fetchImpl: FetchLike = fetch): JiraAdapter {
  const { JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY } = config;
  if (!JIRA_BASE_URL || !JIRA_EMAIL || !JIRA_API_TOKEN || !JIRA_PROJECT_KEY) {
    return new UnconfiguredJiraAdapter('Jira needs JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN and JIRA_PROJECT_KEY');
  }
  return new JiraCloudAdapter(JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY, config.JIRA_ISSUE_TYPE, config.JIRA_LABEL, fetchImpl);
}

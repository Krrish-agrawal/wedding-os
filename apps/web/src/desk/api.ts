import type {
  Delivery,
  DeliveryChannel,
  IntegrationsResponse,
  IntegrationTestRequest,
  IntegrationTestResponse,
  LeadDetail,
  LeadSummary,
  OutboxItem,
  ReportChannel,
  SessionState,
} from '@ave/shared';

/** Typed calls to the Lead Desk API. Errors carry the server's own message when it sent one. */

export class DeskApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

const NETWORK_ERROR = 'Could not reach the server. Check your connection and try again.';

export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new DeskApiError(NETWORK_ERROR, null);
  }
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || body === null) {
    throw new DeskApiError(body?.error ?? `The server answered ${res.status}.`, res.status);
  }
  return body;
}

export const postJson = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export const deskApi = {
  leads: () => request<{ leads: LeadSummary[] }>('/api/leads').then((r) => r.leads),
  lead: (id: string) => request<{ lead: LeadDetail }>(`/api/leads/${encodeURIComponent(id)}`).then((r) => r.lead),
  outbox: () => request<{ items: OutboxItem[] }>('/api/outbox').then((r) => r.items),
  leadOutbox: (id: string) => request<{ items: OutboxItem[] }>(`/api/leads/${encodeURIComponent(id)}/outbox`).then((r) => r.items),
  sendReport: (id: string, channels: ReportChannel[]) =>
    request<{ deliveries: Delivery[] }>(`/api/leads/${encodeURIComponent(id)}/report`, postJson({ channels })).then((r) => r.deliveries),
  join: (sessionId: string, humanName: string) =>
    request<{ handoff: SessionState['handoff'] }>(`/api/sessions/${encodeURIComponent(sessionId)}/handoff/join`, postJson({ humanName })),
  handBack: (sessionId: string) =>
    request<{ handoff: SessionState['handoff'] }>(`/api/sessions/${encodeURIComponent(sessionId)}/handoff/return`, postJson({})),
  integrations: () => request<IntegrationsResponse>('/api/desk/integrations'),
  testIntegration: (channel: DeliveryChannel, body: IntegrationTestRequest) =>
    request<IntegrationTestResponse>(`/api/desk/integrations/${encodeURIComponent(channel)}/test`, postJson(body ?? {})).then((r) => r.delivery),
};

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong.';
}

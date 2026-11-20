import type { CopilotResult, Delivery, OutboundDraft, OutboundPreview, PipelineCard, PipelineOutcome, PipelineResponse } from '@ave/shared';
import { postJson, request } from './api';

/** Typed calls for the copilot bar, preview-then-send, property photos and the pipeline board. */

export interface MediaItem {
  label: string;
  /** Path the web app serves, for thumbnails. */
  path: string;
  /** Public URL WhatsApp can fetch, or null without a tunnel. */
  url: string | null;
}

export interface PropertyMediaResponse {
  items: MediaItem[];
  /** Why photos cannot be sent right now, or null. */
  unavailable: string | null;
}

export interface PreviewEdits {
  text?: string;
  subject?: string | null;
}

const sessionUrl = (id: string) => `/api/sessions/${encodeURIComponent(id)}`;

export const copilotApi = {
  run: (sessionId: string, command: string, nextStepId?: string) =>
    request<CopilotResult>(`${sessionUrl(sessionId)}/copilot`, postJson({ command, ...(nextStepId ? { nextStepId } : {}) })),
  preview: (sessionId: string, draft: OutboundDraft) => request<OutboundPreview>(`${sessionUrl(sessionId)}/outbound/preview`, postJson(draft)),
  send: (sessionId: string, previewId: string, edits: PreviewEdits) =>
    request<{ delivery: Delivery }>(`${sessionUrl(sessionId)}/outbound/${encodeURIComponent(previewId)}/send`, postJson(edits)).then((r) => r.delivery),
  /** Best effort: an unsent preview expires on the server anyway. */
  discard: (sessionId: string, previewId: string) =>
    fetch(`${sessionUrl(sessionId)}/outbound/${encodeURIComponent(previewId)}`, { method: 'DELETE' }).then(
      () => undefined,
      () => undefined,
    ),
  media: (propertyId: string) => request<PropertyMediaResponse>(`/api/media/properties/${encodeURIComponent(propertyId)}`),
  pipeline: () => request<PipelineResponse>('/api/pipeline'),
  setOutcome: (leadId: string, outcome: PipelineOutcome) =>
    request<{ card: PipelineCard }>(`/api/leads/${encodeURIComponent(leadId)}/outcome`, postJson({ outcome })).then((r) => r.card),
};

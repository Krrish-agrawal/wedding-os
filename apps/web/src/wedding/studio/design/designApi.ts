import type { DesignForm } from '@ave/shared';
import { ApiError, authHeaders } from '../../api';
import type { JobStatus } from './helpers';

/** Client for the AI design routes (see docs/AI_DESIGN_CONTRACT.md). Every call turns a missing or failing route into an ApiError with a readable message. */

export interface DesignStatus { visionConfigured: boolean; visionModel: string | null; storage: 'local' | 's3'; limits: { maxFiles: number; maxBytesPerFile: number; retentionHours: number }; flagEnabled: boolean }
export interface UploadedImage { id: string; mime: string; bytes: number; createdAt: number; expiresAt: number }
export interface DesignJob {
  id: string; status: JobStatus; progress: number; source: 'vision' | 'demo'; error: { code: string; message: string } | null;
  versionId: string | null; startedAt: number; finishedAt: number | null; latencyMs: number | null; usage: { model: string; promptTokens: number; completionTokens: number } | null;
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { ...(init?.body !== undefined && !(init.body instanceof FormData) ? { 'content-type': 'application/json' } : {}), ...authHeaders(url), ...init?.headers } });
  } catch { throw new ApiError('Cannot reach the server. Is it running?', 0); }
  const body = (await res.json().catch(() => ({}))) as { error?: string; hint?: string; code?: string };
  if (!res.ok) throw new ApiError(res.status === 404 ? 'The AI design service is not available on this server.' : body.error ?? `Request failed (${res.status})`, res.status, body.hint);
  return body as T;
}

const base = (id: string) => `/api/wedding/${id}`;

export const designApi = {
  status: (id: string) => call<DesignStatus>(`${base(id)}/design/status`),
  upload: (id: string, file: File) => { const f = new FormData(); f.append('file', file); return call<{ image: UploadedImage }>(`${base(id)}/images`, { method: 'POST', body: f }); },
  deleteImage: (id: string, imageId: string) => call<{ ok: true }>(`${base(id)}/images/${imageId}`, { method: 'DELETE' }),
  generate: (id: string, body: { form: DesignForm; venueId: string; imageIds: string[] }) => call<{ job: DesignJob }>(`${base(id)}/design/generate`, { method: 'POST', body: JSON.stringify(body) }),
  another: (id: string) => call<{ job: DesignJob }>(`${base(id)}/design/another`, { method: 'POST' }),
  job: (id: string, jobId: string) => call<{ job: DesignJob }>(`${base(id)}/design/jobs/${jobId}`),
  cancel: (id: string, jobId: string) => call<{ job: DesignJob }>(`${base(id)}/design/jobs/${jobId}/cancel`, { method: 'POST' }),
};

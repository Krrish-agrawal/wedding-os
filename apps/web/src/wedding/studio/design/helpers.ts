import { DECOR_CATALOG, findEntry, type DesignVersion } from '@ave/shared';

/** Wording for where a design came from. The only place that decides what the UI may claim about photographs. */
export type DesignSource = 'vision' | 'demo' | 'manual' | null;

export function describeSource(source: DesignSource): { badge: string; line: string; analysedPhotos: boolean } {
  switch (source) {
    case 'vision': return { badge: 'AI design from your photos', line: 'An AI vision model looked at your inspiration photographs and the studio laid out a design inspired by them.', analysedPhotos: true };
    case 'demo': return { badge: 'SAMPLE design', line: 'Sample design: built from your written choices only. Your photographs were NOT analysed.', analysedPhotos: false };
    case 'manual': return { badge: 'Saved from your edits', line: 'A snapshot of the scene as you edited it.', analysedPhotos: false };
    default: return { badge: 'No design yet', line: 'No design has been generated yet.', analysedPhotos: false };
  }
}

export interface VersionSummary { id: string; label: string; costInr: number; pieces: number; byCategory: Record<string, number>; palette: string[] }

/** Numbers for one stored version, computed from its objects (never from the model). */
export function summariseVersion(v: Pick<DesignVersion, 'id' | 'label' | 'objects' | 'costInr' | 'brief'>): VersionSummary {
  const byCategory: Record<string, number> = {};
  for (const o of v.objects) { const c = findEntry(DECOR_CATALOG, o.catalogId)?.category ?? 'other'; byCategory[c] = (byCategory[c] ?? 0) + 1; }
  return { id: v.id, label: v.label, costInr: v.costInr, pieces: v.objects.length, byCategory, palette: v.brief?.palette.map((p) => p.color) ?? [] };
}

export interface VersionComparison { a: VersionSummary; b: VersionSummary; costDifferenceInr: number; pieceDifference: number; categories: { category: string; a: number; b: number }[] }

export function compareVersions(a: DesignVersion, b: DesignVersion): VersionComparison {
  const sa = summariseVersion(a), sb = summariseVersion(b);
  const cats = [...new Set([...Object.keys(sa.byCategory), ...Object.keys(sb.byCategory)])].sort();
  return { a: sa, b: sb, costDifferenceInr: sb.costInr - sa.costInr, pieceDifference: sb.pieces - sa.pieces, categories: cats.map((category) => ({ category, a: sa.byCategory[category] ?? 0, b: sb.byCategory[category] ?? 0 })) };
}

export type JobStatus = 'pending' | 'analysing' | 'planning' | 'rendering' | 'completed' | 'failed' | 'cancelled';
export const TERMINAL: readonly JobStatus[] = ['completed', 'failed', 'cancelled'];

export const stageLabel = (status: JobStatus, source: 'vision' | 'demo'): string => {
  switch (status) {
    case 'pending': return source === 'vision' ? 'Getting ready…' : 'Getting ready…';
    case 'analysing': return source === 'vision' ? 'Analysing your photos…' : 'Building a sample design from your choices…';
    case 'planning': return 'Planning the layout…';
    case 'rendering': return 'Rendering the 3D scene…';
    case 'completed': return 'Your design is ready';
    case 'failed': return 'Something went wrong';
    case 'cancelled': return 'Cancelled';
  }
};

export const ERROR_MESSAGES: Record<string, string> = {
  rate_limited: 'The AI provider is busy right now. Wait a minute and try again.',
  quota: 'The AI provider account has run out of credit. The site owner needs to top it up.',
  timeout: 'The AI took too long to answer. Try again.',
  provider_down: 'The AI provider is having trouble. Try again shortly.',
  refused: 'The AI declined to describe those photographs. Try different photos.',
  invalid_output: 'The AI gave an answer the studio could not use. Try again.',
  plan_failed: 'The design would not fit this venue or budget. Try a larger venue or a higher budget.',
  cancelled: 'You cancelled this design.',
};
export const errorMessage = (code: string | undefined, fallback?: string) => (code && ERROR_MESSAGES[code]) || fallback || 'The design could not be created.';

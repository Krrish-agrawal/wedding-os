import { matchByName, type LegalDoc, type ToolInput, type ToolResult } from '@ave/shared';
import type { ToolContext } from '../context.js';
import { dispatch, fail, ok, resolveProperty } from '../kit.js';

const LEGAL_NOTE = 'Sample documents for this demo';
const STATUS_TEXT: Record<LegalDoc['status'], string> = {
  verified: 'verified',
  pending: 'pending',
  not_applicable: 'not applicable',
};

export function showLegal(tc: ToolContext, input: ToolInput<'showLegal'>): ToolResult {
  const r = resolveProperty(tc);
  if (!r.bundle) return r.result;
  const docs = r.bundle.legal.documents;
  const query = input.document?.trim();
  const doc = query ? docs.find((d) => d.id === query) ?? matchByName(docs.map((d) => ({ ...d, name: d.title })), query) : null;

  dispatch(tc, { type: 'set_view', view: 'legal', params: { docId: doc?.id ?? null } });
  const expression = input.tone ?? 'composed';

  if (query && !doc) {
    return fail(tc, `There is no "${query}" among the documents.`, `Explain what you can from these instead: ${docs.map((d) => d.title).join(', ')}. Offer a senior advisor for anything else.`);
  }
  if (doc) {
    return ok(
      tc,
      {
        title: doc.title,
        status: STATUS_TEXT[doc.status],
        reference: doc.reference,
        issuedBy: doc.issuedBy,
        ...(doc.date ? { date: doc.date } : {}),
        explanation: doc.explanation,
        note: LEGAL_NOTE,
      },
      expression,
    );
  }
  const count = (s: LegalDoc['status']) => docs.filter((d) => d.status === s).length;
  return ok(
    tc,
    {
      documents: docs.map((d) => ({ id: d.id, title: d.title, status: STATUS_TEXT[d.status], summary: d.summary })),
      verified: count('verified'),
      pending: count('pending'),
      note: LEGAL_NOTE,
    },
    expression,
  );
}

import { field, requestJson } from './http.js';
import type { CrmAdapter, CrmLead, CrmOutcome, FetchLike } from './types.js';

const HUBSPOT_API_BASE = 'https://api.hubapi.com';
/** HubSpot-defined association type ids (CRM associations v4 defaults). */
const ASSOC_DEAL_TO_CONTACT = 3;
const ASSOC_NOTE_TO_CONTACT = 202;
const ASSOC_NOTE_TO_DEAL = 214;
/** Stages of HubSpot's default sales pipeline. */
const DEFAULT_PIPELINE = 'default';
const STAGE_VISIT_BOOKED = 'appointmentscheduled';
const STAGE_QUALIFIED = 'qualifiedtobuy';
const HTTP_NOT_FOUND = 404;

const assoc = (id: string, typeId: number) => ({
  to: { id },
  types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: typeId }],
});

/**
 * HubSpot CRM through a private app token: upserts the contact by email, creates the deal
 * (or updates the one from an earlier sync) and attaches the recap as a note.
 */
export class HubSpotCrmAdapter implements CrmAdapter {
  readonly provider = 'HubSpot';

  constructor(
    private readonly token: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  private call(method: 'POST' | 'PATCH', path: string, body: unknown) {
    return requestJson(this.fetchImpl, `${HUBSPOT_API_BASE}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async syncLead(lead: CrmLead): Promise<CrmOutcome> {
    const contact = await this.call('POST', '/crm/v3/objects/contacts/batch/upsert', {
      inputs: [
        {
          idProperty: 'email',
          id: lead.email,
          properties: { email: lead.email, firstname: lead.firstName, lastname: lead.lastName, phone: lead.phone },
        },
      ],
    });
    const contactId = contact.ok ? field(contact.json, 'results', 0, 'id') : null;
    if (!contactId) return { status: 'failed', detail: `HubSpot contact upsert failed (${contact.ok ? 'no id returned' : contact.reason})` };

    const dealProps: Record<string, string> = {
      dealname: lead.dealName,
      pipeline: DEFAULT_PIPELINE,
      dealstage: lead.visitBooked ? STAGE_VISIT_BOOKED : STAGE_QUALIFIED,
      ...(lead.amount !== null ? { amount: String(Math.round(lead.amount)) } : {}),
    };
    let dealId: string | null = null;
    if (lead.dealId) {
      const updated = await this.call('PATCH', `/crm/v3/objects/deals/${encodeURIComponent(lead.dealId)}`, { properties: dealProps });
      if (updated.ok) dealId = lead.dealId;
      else if (updated.status !== HTTP_NOT_FOUND) return { status: 'failed', detail: `HubSpot deal update failed (${updated.reason})` };
    }
    if (!dealId) {
      const created = await this.call('POST', '/crm/v3/objects/deals', {
        properties: dealProps,
        associations: [assoc(contactId, ASSOC_DEAL_TO_CONTACT)],
      });
      dealId = created.ok ? field(created.json, 'id') : null;
      if (!dealId) return { status: 'failed', detail: `HubSpot deal create failed (${created.ok ? 'no id returned' : created.reason})` };
    }

    const note = await this.call('POST', '/crm/v3/objects/notes', {
      properties: { hs_timestamp: new Date().toISOString(), hs_note_body: noteHtml(lead.note) },
      associations: [assoc(contactId, ASSOC_NOTE_TO_CONTACT), assoc(dealId, ASSOC_NOTE_TO_DEAL)],
    });
    const noteId = note.ok ? field(note.json, 'id') : null;
    if (!noteId) return { status: 'failed', detail: `HubSpot note failed (${note.ok ? 'no id returned' : note.reason})` };

    return { status: 'sent', contactId, dealId, noteId, detail: `Contact ${contactId}, deal ${dealId} and recap note saved in HubSpot` };
  }
}

function noteHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .split('\n')
    .join('<br>');
}

export function createCrmAdapter(token: string | undefined, fetchImpl: FetchLike = fetch): CrmAdapter | null {
  return token ? new HubSpotCrmAdapter(token, fetchImpl) : null;
}

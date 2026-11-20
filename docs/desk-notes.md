# Desk notes

How the Lead Desk, recaps, delivery providers, CRM sync and handoff behave. Code lives in
`apps/server/src/desk/` (server), `apps/web/src/desk/` and `apps/web/src/screens/Desk*.tsx` (web),
and `packages/shared/src/{scoring,desk}.ts` (contracts).

## Leads

- Every session is a lead. `LeadStore` (`node:sqlite`, `apps/server/var/leads.sqlite`) listens to the
  session store and writes each session at most every 400 ms, and flushes on shutdown. On boot it loads
  every stored lead, so the Desk shows past calls after a restart. Live calls stay in memory; a lead is
  "live" only while its session is running on this server.
- The stored row is the full `SessionState` (buyer, lead fields, timeline, transcript, deliveries,
  offers, booking, handoff, timestamps) plus the last EMI inputs per property, which session state
  forgets when the buyer switches property.
- `pnpm reset` deletes `apps/server/var/`, which clears leads, recaps and the outbox. Stop the server first.

## Score

`scoreLead(state, scoring, now)` in `packages/shared/src/scoring.ts`, rules in `data/policy/scoring.json`.
Time on a view is measured between consecutive `view` timeline events (a property switch starts a new
stretch; the call ending closes the last one; the opening view counts from when the call went live).
For a call that is not running, the Desk passes the lead's last activity as `now`, so a dead call never
gains time. Rule types: `view_seen`, `time_on_view`, `offer_applied`, `visit_booked`, `lead_field`,
`handoff_requested`, `properties_viewed`. Scores never go below zero; the tier is the highest one reached.

## When the recap is sent

The recap goes out in exactly these cases:

1. **The AI calls `send_report`** after the buyer agrees (the Tools workstream calls
   `sendReport(ctx, sessionId, channels)` from `apps/server/src/desk/reports.ts`).
2. **An advisor presses Send** on the Lead Desk (`POST /api/leads/:id/report`, body `{ channels? }`,
   default both).
3. **Automatically, once, when the call ends** (`status` becomes `ended`) if the buyer agreed earlier:
   either a recap was already sent on their yes during the call (its channels are reused), or a
   `report_requested` timeline note exists (`REPORT_REQUEST_NOTE_KIND` in `@ave/shared`; both channels).
   If the recap the buyer already has is identical to the final one (same facts), nothing is sent again.
   The "once" flag is stored, so a restart or a second `ended` never sends twice.

Without any of these, nothing is sent: a call ending on its own never messages the buyer.

Each send records every attempt with `upsert_delivery`: `queued`, then `sent` (provider accepted it),
`failed` (with the provider's reason), or `not_configured`. The Outbox keeps a preview of every message.
`sendReport` resolves with the final deliveries and never rejects. Calls for the same session run one
after another. Expected latency: the AI summary is capped at 8 s and each provider call at 10 s.

## What is in the recap

- **Facts** (deterministic, from session state and `/data` through the shared money functions):
  properties opened and the views seen on each, price after offers or the lease monthly total, offers
  applied with the saving, EMI discussed (from the inputs actually used), the booked visit with date,
  time and address, what the buyer told us, and a next step.
- **AI summary** (only when `OPENAI_API_KEY` is set): `REPORT_MODEL` through the official `openai`
  SDK with structured output (`RecapSummarySchema`, validated again with Zod). The model sees only the
  facts (without contact details) and the final transcript lines. It is told not to write numbers; any
  digit in its answer that is not in the facts or transcript drops the AI part entirely. On timeout or
  error the recap goes out without it.
- **Email**: branded HTML (inline styles, table layout) plus a plain-text part; a `site-visit.ics`
  invite (RFC 5545, UTC times) is attached when a visit is booked.
- **WhatsApp**: a short text with the headline number per property and the visit.
- Every recap says the property data is sample data and amounts are estimates.

## Providers

All calls use `fetch` with a 10 s timeout. Errors become `failed` deliveries with a short reason; nothing throws.

### Email: Resend (`EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM`)

`POST https://api.resend.com/emails` with `Authorization: Bearer`, an `Idempotency-Key` (the delivery
id), `from`, `to`, `subject`, `html`, `text`, and `attachments` as `{ filename, content: base64 }`.
`EMAIL_FROM` must be on a domain verified in Resend (the shared `onboarding@resend.dev` sender only
delivers to the account owner's own address).

`EMAIL_PROVIDER=smtp` is recorded as `not_configured`: sending over SMTP needs an SMTP client library
(for example `nodemailer`), which is not installed.

### WhatsApp: Twilio (`WHATSAPP_PROVIDER=twilio`)

`POST https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Messages.json`, Basic auth
(`TWILIO_ACCOUNT_SID:TWILIO_AUTH_TOKEN`), form-encoded `To=whatsapp:+91…`, `From=whatsapp:<sender>`,
`Body`. `TWILIO_WHATSAPP_FROM` may be given with or without the `whatsapp:` prefix (sandbox sender
`+14155238886`). A 201 with status `queued` counts as accepted.

Sandbox rules (checked against Twilio's docs, Nov 2026):
- Each recipient must first send `join <your sandbox code>` to the sandbox number. Others fail with
  error 63015. The opt-in lasts three days, then they must join again.
- Free-form text is only delivered inside the 24-hour customer service window opened by the
  recipient's last message (joining opens one). Outside it only approved templates go through, and the
  sandbox does not support custom templates. So for a demo, the buyer should message the sandbox
  shortly before the call.
- One message every three seconds; trial accounts include a limited number of messages.

### WhatsApp: Meta Cloud API (`WHATSAPP_PROVIDER=meta`)

`POST https://graph.facebook.com/v27.0/{META_WA_PHONE_NUMBER_ID}/messages` with
`Authorization: Bearer META_WA_TOKEN` and `{ messaging_product: "whatsapp", recipient_type:
"individual", to: "+91…", type: "text", text: { preview_url: false, body } }`. Success returns
`messages[0].id`; errors return `error.message` and `error.error_data.details`, which go into the Outbox.

Rules (checked against Meta's docs, Nov 2026):
- Recipients must have opted in to messages from the business.
- Free-form (non-template) messages are only allowed inside the 24-hour customer service window that
  starts when the user messages or calls the business; outside it only pre-approved templates are
  allowed. A plain-text recap to a buyer who never messaged the number is rejected, and the Outbox
  shows Meta's reason.
- The test number only reaches the handful of recipient numbers verified in the app dashboard.
- A 200 means Meta accepted the message, not that it was delivered (delivery comes by webhook, which
  this app does not subscribe to).

Phone numbers are normalised to E.164 with India (+91) as the default country; a number that cannot
be normalised is recorded as `failed` without calling the provider.

### CRM: HubSpot (`HUBSPOT_TOKEN`, private app token)

Runs after each recap, in the background, recorded as a `crm` delivery:
1. `POST /crm/v3/objects/contacts/batch/upsert` with `idProperty: "email"` (email, first and last name, phone).
2. Create a deal (`POST /crm/v3/objects/deals`, default pipeline, stage `appointmentscheduled` when a
   visit is booked else `qualifiedtobuy`, amount = sale price after offers) associated to the contact
   (type 3), or update the deal from the earlier sync (`PATCH`).
3. `POST /crm/v3/objects/notes` with the recap text, associated to the contact (202) and the deal (214).

The private app needs write access to contacts and deals (`crm.objects.contacts.write`,
`crm.objects.deals.write`, plus the read scopes) and whatever HubSpot lists under "Scope requirements"
on the notes API page; a missing scope shows up as a failed `crm` delivery with HubSpot's message.
Without the token nothing is attempted and the Desk works as usual.

## Handoff

- Buyer side: `set_handoff { status: 'requested', reason }` (button, or the `request_human` tool). The
  Desk feed rings: the live call card turns coral and its Join button pulses (no sound).
- `POST /api/sessions/:id/handoff/join` `{ humanName }` sets `joined` (409 if the call ended or another
  advisor is already on it). The Voice workstream stops the agent on this transition.
- `POST /api/sessions/:id/handoff/return` sets `returned` (409 unless someone joined). Voice restarts
  the agent and adds `buildHandoffContext(state, content)` (exported from
  `apps/server/src/desk/handoff.ts`) to its prompt: who joined and why, what is on screen, what the
  buyer said they want, what is already done, and the lines spoken while the human was on.
- Advisor audio: `/desk/call/:sessionId` calls `useAdvisorAudio(sessionId, humanName)` from
  `apps/web/src/call/voice/advisor.ts`, a stub for the Voice workstream to implement.

## API

| Route | What |
|---|---|
| `GET /api/leads` | `{ leads: LeadSummary[] }`, live first, then by last activity |
| `GET /api/leads/:id` | `{ lead: LeadDetail }` with score reasons, time per view, offers, EMI, booking, transcript, timeline, deliveries, AI summary and the recap preview |
| `POST /api/leads/:id/report` | Send the recap now; `{ channels?: ('email' \| 'whatsapp')[] }` |
| `GET /api/outbox` | `{ items: OutboxItem[] }`, newest first, with previews |
| `POST /api/sessions/:id/handoff/join` | Human advisor joins |
| `POST /api/sessions/:id/handoff/return` | Hand back to the AI |

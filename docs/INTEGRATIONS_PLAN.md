# Integrations, consult mode and MCP: plan

Companion to `BUILD_PLAN.md`. This covers four things:

1. WhatsApp, email, Slack and Jira wired into one end-to-end sales pipeline.
2. Human handoff as a full "consult" on the Lead Desk:
   - an incoming-call alert
   - the human joins
   - AI notes taken live
   - the admin drives the buyer's screen and sends messages
3. MCP: how the voice agent reaches the app's tools, and how that stays safe as integrations are added.
4. A pipeline board that shows every step firing.

Deadline: submission on 21 Nov 2026 at 12:30 IST. The order of work below is set by what the demo needs most.

---

## 0. What already exists (build on it, don't rebuild)

| Area | Today | Where |
|---|---|---|
| Email | Resend adapter: recap with an HTML body and a `.ics` attachment, honest `sent` / `failed` / `not_configured` outcomes | `apps/server/src/desk/adapters/email.ts` |
| WhatsApp | Twilio (sandbox) and Meta Cloud API adapters, E.164 normalising | `desk/adapters/whatsapp.ts` |
| CRM | HubSpot: contact upsert, deal create or update, recap note | `desk/adapters/crm.ts` |
| Outbox | Every delivery is stored on the session (`deliveries[]`) and listed on the Desk with a preview | `desk/reports.ts`, `apps/web/src/desk/Outbox.tsx` |
| Handoff | `requestHuman` tool, then a pulsing Join card on the Desk. The human joins on `/desk/call/:id` (RTC audio, same stage and view dock). The AI leaves with a handover line, and on hand back a new agent starts with `buildHandoffContext` | `desk/handoff.ts`, `screens/DeskCall.tsx`, `voice/controller.ts` |
| Tools over MCP | 17 tools served at `/mcp` (stateless streamable HTTP, a bearer token per call), which the Agora agent reaches through `mcp_servers` | `tools/mcp.ts`, `voice/joinConfig.ts` |
| Tool loop outside voice | `SimAdvisor` runs OpenAI chat completions against the same tools | `agent/sim.ts` |

**Gap that matters most.** While the human is on the call, nothing transcribes the conversation, because the AI agent has left the channel. So no notes can be taken from it yet, and the hand-back context only has what was typed.

---

## 1. The demo story (what the judges see, about 4 minutes)

1. Priya calls. Shivam qualifies her, tours Larkspur Court, shows the EMI, and books Saturday 11:00.
2. **Within seconds of the booking, four things land on screen:**
   - **WhatsApp** on the phone on stage: "Visit confirmed: Larkspur Court, Sat 11:00, map link".
   - **Slack** `#sales-pipeline`: a visit card with the score and an *Open in Lead Desk* button.
   - **Jira**: the task "Prepare site visit: Larkspur Court, Sat 11:00 (Priya)", due Friday.
   - **HubSpot**: the deal moves to *Appointment scheduled*.
3. Priya asks: "Can I talk to someone about the price?"
   - **Desk**: a full-screen incoming-call alert rings, showing the AI's three-line brief.
   - **Slack**: the same alert with a *Join call* button.
4. The admin accepts.
   - Shivam hands over, and Priya sees "Rahul from the team joined".
   - **Live notes** fill in as they talk: what she asked, what Rahul promised, her objections, next steps.
   - Each next step has a one-click action button.
5. The admin types into the copilot bar:
   - "show the plumbing in the second bathroom": Priya's screen changes.
   - "send her the price sheet on WhatsApp": a preview appears, the admin confirms, and it arrives on the phone.
   - "jira: get manager approval for 2% discount": a task is created and linked in the notes.
6. **Hand back.** Shivam returns already knowing what Rahul agreed.
7. **The call ends.**
   - Email recap with the visit invite.
   - Slack thread update.
   - Jira tasks for each open action item.
   - HubSpot note with the consult notes.
   - The pipeline board shows the whole trail.

---

## 2. Integrations pipeline (WhatsApp, email, Slack, Jira)

### 2.1 Adapters (same pattern as the existing ones)

**Slack** (`desk/adapters/slack.ts`)
- **Primary path:** the bot token calls `chat.postMessage` with Block Kit.
  - The result's `ts` is saved, so later events for the same lead reply **in a thread**.
  - The *Open in Lead Desk* and *Join call* buttons are URL buttons, so they need no interactivity endpoint.
- **Fallback:** an incoming webhook (one URL, no threads).
- **Env:** `SLACK_BOT_TOKEN`, `SLACK_CHANNEL_ID`, or `SLACK_WEBHOOK_URL`.

**Jira** (`desk/adapters/jira.ts`)
- **Call:** Jira Cloud REST v3, `POST {JIRA_BASE_URL}/rest/api/3/issue`, Basic auth with `email:api_token`.
- **Issue fields:**
  - the description in Atlassian Document Format, with the lead link, property and quotes from the call
  - a fixed label from env
  - `duedate`
- **Stored on the delivery:** the issue key and URL, so the Desk links to it.
- **Env:** `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEY`, `JIRA_ISSUE_TYPE` (default `Task`), `JIRA_LABEL`.
- No project key or label is written in code.

**WhatsApp additions** (`whatsapp.ts`)
- **Media:** a `mediaUrl` field (Twilio `MediaUrl` / Meta `image.link`) for property photos from `/media`.
- **Links:** to the buyer's read-only summary page, which serves as their property page.

**Email:** no change. Resend can send to the account owner's own address without a verified domain, which is enough for the demo.

### 2.2 Shared contract changes

- `DeliverySchema.channel` adds `slack` and `jira`.
- New optional fields on a delivery: `ref` (Slack `ts` or Jira key), `url`, `purpose` (`visit_confirmed`, `handoff_alert`, `call_summary`, `action_item`, `manual`).
- The Outbox filters, `CHANNEL_NAME` and `CHANNEL_ICON` gain both channels.

### 2.3 Automation rules (`desk/automations.ts`)

One table of rules. Each rule has:
- a **trigger**: a reducer action or transition
- **channels**
- a **builder** for the message
- an **idempotency key** (`session:rule:subject`), so a retry or a server restart never sends twice

| Trigger | WhatsApp (buyer) | Email | Slack | Jira | HubSpot |
|---|---|---|---|---|---|
| Visit booked | Confirmation + map link | `.ics` invite | Visit card (new thread) | "Prepare site visit", due the day before | Stage *Appointment scheduled* |
| Human requested | — | — | Alert + *Join call* button (thread) | — | — |
| No one joins in `HANDOFF_TIMEOUT_MS` | "Our team will call you back at …" | — | Escalation in thread | "Call back Priya", due today | — |
| Consult action item (admin clicks or confirms) | as chosen | as chosen | as chosen | Task with quote + owner | — |
| Call ended | Recap (exists) | Recap (exists) + consult commitments | Summary in thread | One task per open action item | Note (exists) + consult notes |

- **Switches:** `AUTOMATIONS=whatsapp,email,slack,jira,crm` turns channels on and off without code changes.
- **Unconfigured channels:** each is recorded as `not_configured`, never faked.

### 2.4 Two-way WhatsApp (stretch)

- `POST /api/integrations/whatsapp/inbound` is Twilio's webhook, reached through the existing tunnel.
- It validates `X-Twilio-Signature` and matches the sender's phone to a lead.
- It adds the message to the lead timeline and posts it to the Slack thread.
- The Desk shows "Priya replied on WhatsApp" with a suggested reply.

---

## 3. Human handoff as a consult

### 3.1 Incoming call (Desk)

- **Global overlay:** an `IncomingCall` overlay is mounted on every Desk route, not only the Live calls panel. It shows:
  - the buyer, the property and the reason
  - a waiting timer
  - **the AI's brief**: the latest `buildHandoffContext`-style summary, which already exists server-side, exposed through `GET /api/sessions/:id/brief`
- **Buttons:** *Accept* goes to `/desk/call/:id?join=1` (that join flow exists). *Not now* snoozes the alert for this browser.
- **Ring:** a soft two-tone ring generated with WebAudio, so there's no audio file to ship. It's muted until the admin has clicked once on the page, because browsers block autoplay before that.
- **In parallel:** the Slack alert (2.3).
- **Timeout:** after `HANDOFF_TIMEOUT_MS`, the AI tells the buyer the team will call back, and the callback task is created.

### 3.2 Live transcription while the human talks

**Primary: Agora Real-Time STT (another Agora product in the story)**
- **Start:** on the `joined` transition, the server starts an STT task:
  - endpoint: `POST https://api.agora.io/api/speech-to-text/v1/projects/{appId}/join`, Basic auth (the same customer key and secret as ConvoAI)
  - `languages`: the call language's ASR tag plus `en-IN`
  - `rtcConfig`: `channelName`, `pubBotUid`, `pubBotToken`, `subscribeAudioUids: [buyerUid, advisorUid]`
  - `enableJsonProtocol: true`
- **Stop:** the task stops on `returned` or when the call ends.
- **Receive:** the admin's browser is already in the channel. It reads `stream-message` from `pubBotUid` and ungzips it with the built-in `DecompressionStream` when the payload starts with gzip magic bytes, so nothing gets installed.
- **Forward:** final lines go to the server as `add_transcript` with role `human` or `buyer`, decided by uid. Only the admin's browser forwards, so there are no duplicates.
- **Needs:**
  - Real-Time STT enabled for the app in Agora Console, which only you can do
  - the stop endpoint confirmed in the v7 reference

**Fallback** (if STT isn't enabled or fails to start):
- The admin's browser records the two tracks separately (mic, and buyer audio) in about 8-second `MediaRecorder` chunks.
- It sends them to `POST /api/sessions/:id/consult/audio`, where `gpt-4o-mini-transcribe` turns them into transcript lines.
- Labels stay correct because each track is its own speaker.
- It uses the existing OpenAI key and needs no install.

### 3.3 Live notes (the scribe)

- **Server:** `desk/consult.ts` subscribes to transcript lines during `joined`.
  - Debounced to about once every 6 seconds and only on new final lines.
  - It calls `gpt-4.1-mini` with a JSON-schema response and gets back the notes:
    ```
    summary: string                       // 2–3 lines, rewritten each time
    buyerAsks: { text, quote }[]
    promises: { text, quote, needsApproval: boolean }[]   // what the human committed to
    objections: string[]
    nextSteps: { text, action?: { kind: 'whatsapp'|'email'|'jira'|'slack'|'view', args } }[]
    ```
  - Notes live on the session as `consult: { status, notes, adminNotes, updatedAt }` through a new reducer action `set_consult`. That way they reach the Desk over the existing socket and are saved with the lead.
- **Desk:** a **Live notes** tab in `ContextPanel`.
  - Sections fill in as the notes arrive, and new items flash briefly.
  - The admin can add their own typed notes, which are kept and shown separately from the AI's.
  - Each next step with an `action` gets a one-click button. Buttons that send something show a preview first.
  - The buyer never sees this tab.
- **Hand back:** `buildHandoffContext` uses the notes (summary, promises, open asks) instead of only the last six lines. Shivam then knows "Rahul agreed to check a 2% discount with his manager" and doesn't contradict it.
- **After the call:**
  - Commitments the buyer should see go into the email recap.
  - The internal notes go to the HubSpot note, the Slack thread and Jira tasks.

### 3.4 The admin drives the call (copilot bar)

**Quick actions** (no LLM) above the existing view dock:
- **Send on WhatsApp**: summary link, photos, location pin, price sheet
- **Email recap now**
- **Create task**
- **Notify team**

**Command bar** (typed, so the buyer doesn't hear the instructions): `POST /api/sessions/:id/copilot`.
- **Engine:** `SimAdvisor` with a different brief: "You carry out the human advisor's instructions on the buyer's screen and in our tools; you never speak to the buyer."
- **Tools:**
  - all 16 existing tools, run with `source: 'advisor'`
  - `sendWhatsApp`, `sendEmail`, `createTask` (Jira), `notifyTeam` (Slack)
- **Examples:**
  - "show the master bathroom plumbing" → `showBlueprint`
  - "EMI with 1.5 crore down over 15 years" → `showMoney`
  - "send her the floor plan on WhatsApp" → `sendWhatsApp`, after a preview
- **Outbound safety:** any message that leaves the app comes back as a **preview card** (recipient, text, media), and nothing goes out until the admin clicks Send. This mirrors the "actions that need a yes" rule the voice agent already follows.
- **Activity log:** what ran, plus links (Jira key, Slack message).

---

## 4. MCP integrations

Decided on 20 Nov: no Desk MCP for Claude Desktop (the app will run on another machine) and no Zapier hub.

- **Voice agent → our MCP (exists).** The Agora agent reaches the app's 17 tools through ConvoAI `mcp_servers` (stateless streamable HTTP, a bearer token per call).
- **No raw integration tools for the voice agent.** A caller could talk it into posting anything, so Slack, Jira and email sends happen on the server, from fixed rules (2.3) or from the admin's confirmed previews (3.4). The voice agent's tool list does not change, which keeps the 12 conversation scenarios stable.
- **Integrations page (Desk).** Each integration shows its status (configured, last success, last error) and a **Send test** button, and the page shows the MCP link: Agora agent → `estates` MCP (17 tools).

## 5. Pipeline board (Desk)

- **Columns:** New call → Qualified → Visit booked → Human consult → Follow-up → Won / Lost. The stage comes from the existing lead scoring plus the new consult and booking state.
- **Cards:** each card shows integration badges for what fired: WhatsApp ✓, Email ✓, Slack ✓, Jira key, HubSpot ✓.
- **Funnel:** counts and conversion run along the top.
- **Activity feed:** a live list on the right, for example "Slack: visit card posted" or "Jira: task created".

---

## 6. Order of work and estimates

**Contract first.** One short step changes the shared schemas, because every later workstream reads them:
- the delivery channels and fields
- `consult` on the session and the `set_consult` action
- the copilot API types

After that, three workstreams run in parallel. Each owns its own files.

| # | Workstream | Contents | Est. |
|---|---|---|---|
| A | Integrations | Slack + Jira adapters, WhatsApp media, automation rules, Outbox + activity feed, tests with fake fetch | ~3 h |
| B | Consult | Incoming-call overlay + ring, STT start/stop + browser relay, OpenAI fallback, scribe, Live notes tab, hand-back with notes | ~4 h |
| C | Copilot + board | Copilot endpoint and bar, quick actions, preview-then-send, pipeline board | ~4 h |
| D | Rehearsal | End-to-end live run, `pnpm reset`, demo script | ~2 h |

**Cut order if time runs short:**
1. Two-way WhatsApp (2.4)
2. Pipeline board funnel numbers (keep the columns)
3. STT (use the OpenAI fallback only)

### What only you can set up (about 45 minutes, can run while we build)

Each needs an account in your name, and the passwords stay with you. Add the keys to `.env`; `.env.example` will list every name.

| Service | Steps | Keys |
|---|---|---|
| Twilio WhatsApp sandbox | 1. Free trial. 2. Messaging → Try WhatsApp. 3. Send the join code from the demo phone. | `WHATSAPP_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` |
| Resend | Free account, then an API key. Sends from `onboarding@resend.dev` to your own address. | `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM` |
| Slack | 1. Free workspace. 2. Create an app with the `chat:write` scope. 3. Install it. 4. Invite it to `#sales-pipeline`. | `SLACK_BOT_TOKEN`, `SLACK_CHANNEL_ID` |
| Jira Cloud | 1. Free site. 2. A Scrum or Kanban project. 3. An API token from id.atlassian.com. | `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEY` |
| Agora | In Console, enable Real-Time STT for this app | — |
| HubSpot (optional) | A private app token with the contacts, deals and notes scopes | `HUBSPOT_TOKEN` |

---

## 7. Risks and how they're handled

| Risk | Handling |
|---|---|
| WhatsApp's 24-hour window and sandbox join | The demo phone joins the sandbox the morning of the demo and sends one message, which keeps free-form text open all day. |
| Real-Time STT not enabled, or slow to start | The OpenAI chunk fallback starts automatically, and the notes panel says which source is live. |
| Venue network or tunnel drops | Integration sends happen server-side and are queued with idempotency keys, so they retry without duplicates. The self-healing tunnel is already running. |
| Copilot sends something wrong | Every outbound message goes through preview-then-send, and the voice agent never gets raw integration tools. |
| Jira cost | Jira Cloud Free covers up to 10 users and includes API tokens, which is all the app needs. |
| Secrets | All secrets stay in `.env`. Tokens are never logged or put in URLs. The Twilio webhook is checked with its signature. |
| Duplicate sends after a restart | Idempotency keys are stored with each delivery and checked before every send. |

# Agora Virtual Estates — Build Plan

A desktop web app where a property buyer has one live video-style call with an AI property advisor. The advisor talks in real time, and as the conversation moves it changes what is on screen: the shortlist, a guided 3D tour, wiring and plumbing plans, the neighbourhood, commute routes, sunlight and Vastu, pricing and EMI, legal papers, and a site-visit booking. Every call becomes a tracked lead with a report sent by email and WhatsApp, and a human advisor can join the same call at any moment.

This document is the full brief for the coding agents that build it.

---

## 0. How to work from this document

1. **Read all of it before writing code.** The sections depend on each other, especially the shared contracts in section 7 and section 16.
2. **Verify every external API against its live documentation before coding against it.** Section 19 lists the pages. The config sketches here were assembled from those pages but are not guaranteed to be field-exact. Where this plan and the docs disagree, the docs win.
3. **Environment rules (strict).**
   - Everything lives inside this project folder. No global installs, no `curl | sh` installers, no changes to shell profiles or system settings.
   - Do not add dependencies on your own. The lead agent owns `package.json` files and the lockfile. If a workstream needs a package, report it back instead of installing it.
   - Do not download browsers or large tool binaries (for example Playwright browsers) without the owner's approval.
   - Download nothing from untrusted sources. 3D models and brand files are supplied by the owner.
   - Use Node's built-in `node:sqlite` rather than a native SQLite module.
4. **Work in parallel with sub-agents.** There are many independent components. The lead agent does the foundation in section 16, then splits the rest across sub-agents with clear file ownership, and integrates.
5. **Quality bar: two properties, flawless.** The goal is not breadth. It is one sale apartment and one lease office that work end to end, quickly, with no dead ends, no placeholder text, and no errors. Anything that cannot be made solid gets cut, not shipped half-working.
6. **Ask the owner only for the inputs in section 18.** Everything else, decide and move on. If an owner input is missing, build around it with a clearly named placeholder and keep going.

---

## 1. Product principles

- **The voice drives the screen.** The buyer never hunts through menus. They ask, and the right view appears with the advisor already talking about it. Every view is also clickable, and the advisor knows what was clicked.
- **Everything the advisor says is grounded.** Prices, areas, distances, legal facts and room details come from tool results backed by data files. The advisor never invents a number.
- **Actions, not just answers.** The call ends with something done: a site visit booked, an offer applied, a report sent, a lead recorded, a human brought in.
- **It feels like a call with a person.** Low latency, interruptible mid-sentence, an expressive on-screen presence, live captions, and no visible loading between views.
- **Honest.** Demo property data is labelled as sample data. Delivery statuses (email sent, WhatsApp sent) reflect what really happened.

---

## 2. Storyline the product must support

A buyer is relocating to Bengaluru and needs a home, and their small team needs an office. The shortlist therefore holds exactly two properties:

| | Property A (primary flow) | Property B (second flow) |
|---|---|---|
| Type | Apartment, for sale | Small office suite, for lease |
| 3D model | Modern Apartment (Visthétique) | Loft 18 mini office, environment version (dasy444) |
| Money view | Price breakup, EMI, offers | Monthly rent, deposit, per-seat cost, lease terms |
| Special views | Sunlight and Vastu, wiring, plumbing | Seating capacity, wiring, plumbing |

Presenting two as "the two that match what you told me" makes the shortlist feel curated rather than thin. Do not show extra listings that lack a full flow.

**Golden path the finished app must run without a hitch:**

1. Buyer enters name, phone and email on the landing page. The advisor "calls" them: a ringing screen, they accept.
2. Advisor greets them by name and asks what they need. Buyer describes home and office needs. Lead fields fill in.
3. "Show me what's available." Shortlist view appears with both properties.
4. "Let's see the apartment." 3D tour opens. Advisor walks room to room, one stop at a time. Buyer interrupts: "go back to the kitchen", "show me the bedroom". Camera glides there.
5. "Where are the power points and the AC points?" Blueprint view opens on the electrical layer. "And the plumbing?" Layer switches.
6. "What's the area like?" Locality view: satellite map, pin, nearby places. Buyer cross-questions: "any good schools?", "how far is the metro?"
7. "How long to the airport? And to the office you showed me?" Commute view draws routes with distance and time.
8. "Does the bedroom get morning sun? Is it Vastu-friendly?" Compass view: sun path and Vastu zones over the plan.
9. "What does it cost?" Money view: full breakup. "What's the EMI with 2 crore down over 20 years?" Calculator updates live. "Any offers?" Offers appear; one is applied and the total changes.
10. Buyer pushes for a discount beyond the advisor's limit. Advisor offers what it is allowed to, then proposes bringing in a senior advisor.
11. "Is the paperwork clean?" Legal view: registration, approvals, title, with plain-language explanations.
12. Human advisor joins the same call from the Lead Desk, sees the whole context, talks to the buyer, and can drive the same views.
13. Site visit is booked after explicit confirmation. Recap goes out by email and WhatsApp. The call ends on a summary screen.
14. Lead Desk shows the lead with timeline, score, objections, and delivery status.
15. The office flow repeats steps 4 to 9 and 11 with the lease variant.

---

## 3. Surfaces

| Route | Who | What |
|---|---|---|
| `/` | Buyer | Landing: brand, one-line promise, short lead form, "Start my tour" |
| `/call/:sessionId` | Buyer | Ringing screen, then the call: stage, advisor presence, captions, controls |
| `/call/:sessionId/summary` | Buyer | Post-call recap: what was seen, numbers discussed, next step, report delivery status |
| `/desk` | Human advisor | Lead Desk: live calls, lead list, lead detail, outbox |
| `/desk/call/:sessionId` | Human advisor | Join a live call: buyer context, transcript, same stage, view controls |
| `/studio` | Developer only | Authoring and testing tools (section 14). Excluded from production navigation. |

Desktop only. Design for 1280 to 1920 wide. Below 1100 show a polite "open on a laptop" screen.

---

## 4. The call screen

### 4.1 Layout

- **Stage (about 70% width):** the current view. Views cross-fade; the 3D canvas stays mounted underneath at all times so returning to the tour is instant.
- **Presence rail (right):** advisor tile (avatar, name, state: listening, thinking, speaking, standing by), buyer self-view tile (local camera preview; initials if camera is declined), and a third tile that appears when a human advisor joins.
- **Captions:** live transcript of both sides under the presence tiles, partial lines visibly different from final lines.
- **View dock (bottom of stage):** one chip per view, colour-coded, showing which is active. Clicking a chip switches the view and tells the advisor.
- **Activity strip:** short honest status while a tool runs ("Calculating EMI", "Finding the route").
- **Controls:** mute, camera, type-instead-of-talk, "Talk to a human", end call.
- **Property switcher:** small pill showing the active property with a one-click switch to the other.

### 4.2 Views

Each view is a self-contained module with the same contract: it receives `viewParams` from session state, renders from data files, and emits `ui_event`s. No view fetches from the network at switch time unless stated.

**1. Shortlist**
- Two large property cards: hero render (captured from the 3D model), name, locality, type, key numbers, three highlights.
- Voice: "show me what's available", "the apartment", "the office".
- Clicking a card opens that property.

**2. 3D Tour**
- The property model with authored camera shots (section 10). Two modes: step-by-step (advisor moves one stop per turn) and auto walkthrough (camera drifts through all stops while the advisor gives an overview).
- Room label and two or three fact chips appear at each stop.
- Mini floor plan in a corner with a "you are here" dot; clicking a room goes there.
- Buyer can drag to look around at a stop; the camera eases back when the advisor moves on.
- Voice: "take me to the kitchen", "go back", "show me the whole place", "what's this room's size?".

**3. Blueprint**
- 2D plan of the property with switchable layers: Layout and dimensions, Electrical, Plumbing.
- Electrical: distribution board, circuits, switchboards, sockets, light points, AC points, with a legend.
- Plumbing: cold and hot supply, drain lines, fixtures, the shaft.
- Hovering or naming a room highlights it and lists what it has ("Bedroom: 6 sockets, 1 AC point, 2 light points").
- Voice: "show the wiring", "where are the AC points?", "show plumbing in the bathroom".
- Labelled "Indicative layout".

**4. Locality**
- Satellite map centred on the property pin, with a smooth fly-in.
- Category chips: Schools, Hospitals, Metro and transit, Groceries, Parks, Dining. Choosing one drops pins with names and straight-line distance.
- A short locality profile panel: character of the area, connectivity, and things a buyer should know.
- Voice: "what's the area like?", "any hospitals nearby?", "is it noisy?". The buyer can keep cross-questioning; the advisor answers from locality data.

**5. Commute**
- Map with routes from the property to preset places (airport, main bus station, main railway station, nearest metro station, central business district, major tech parks) and to any place the buyer names.
- Each route shows distance and typical drive time, labelled as an estimate without heavy traffic.
- Includes "home to office": the route between Property A and Property B.
- Voice: "how far is the airport?", "how long to Manyata Tech Park?", "what about my office?".

**6. Compass (sunlight and Vastu)**
- The plan with a compass rose, the entrance direction, and the sun's arc for the property's real coordinates.
- Time-of-day slider (also voice-driven) showing which rooms get direct sun; the 3D tour's light follows the same time.
- Vastu overlay: eight directional zones, a verdict per room, and gentle wording that this is traditional guidance.
- Voice: "does the bedroom get morning sun?", "which way does the door face?", "is the kitchen Vastu-compliant?".
- For the office, the Vastu overlay is replaced by a seating-capacity overlay.

**7. Money**
- Sale variant: itemised price breakup, payment schedule, EMI calculator (down payment, rate, tenure as sliders and by voice) with a principal-versus-interest visual, offers list, and a running "your price" total that changes when an offer is applied.
- Lease variant: monthly rent, maintenance, deposit, fit-out status, per-seat monthly cost, lock-in and escalation terms.
- All amounts in Indian format (₹1,28,00,000 and "1.28 crore").
- Voice: "what's the total?", "EMI with 2 crore down for 20 years", "any offers?", "can you do better on price?".

**8. Legal**
- Document cards: project registration, title, approvals, occupancy status, bank approvals, and for the lease, key lease clauses.
- Each card opens a plain-language explanation and a status (verified, pending, not applicable).
- Voice: "is the paperwork clean?", "what does occupancy certificate mean?".
- Labelled "Sample documents".

**9. Booking**
- Available site-visit slots, the chosen slot, and a confirmation state.
- The advisor must get an explicit yes before booking.

**10. Summary** (post-call route)
- What was viewed, numbers discussed, offer applied, visit booked, and whether the report was delivered by email and WhatsApp.

---

## 5. Advisor presence

The advisor has a name, a face and visible moods. Build presence behind one interface so the implementation can be swapped by configuration:

```ts
interface AgentPresence {
  mount(el: HTMLElement): Promise<void>;
  attachAudio(track: MediaStreamTrack): void;   // the advisor's voice
  setState(s: 'idle' | 'listening' | 'thinking' | 'speaking' | 'standby'): void;
  express(e: Expression): void;                 // see mapping below
  dispose(): void;
}
```

**Mode `human3d` (default):** TalkingHead (`@met4citizen/talkinghead`, MIT) rendering a 3D head-and-shoulders avatar, with HeadAudio driving lip-sync directly from the advisor's audio track, so no text or timestamps are needed.
- Avatar file: the `mpfb.glb` model from the TalkingHead repository (CC0). Other bundled avatars carry non-commercial licences; do not use them.
- Feed HeadAudio from the Agora remote audio track's `MediaStreamTrack` through a Web Audio source node. Keep Agora's own playback for sound. Chrome may need the remote stream attached to a muted media element before Web Audio receives samples; test this first.
- Use TalkingHead's `setMood` (neutral, happy, sad, fear, love and others) and `playGesture` (`handup`, `index`, `ok`, `thumbup`, `side`, `shrug`) for expression.
- TalkingHead imports `three`; make sure the bundle resolves one single `three` version for it and for the tour.
- This path has not been tested with this audio source or with Hindi-English speech. Validate it early.

**Mode `mascot`:** the brand mascot as the advisor's face: mouth and bounce driven by audio level, with hand-authored states. Build it regardless, because the mascot is also used across the UI, and it is the automatic fallback if the 3D avatar fails to load or its lip-sync looks wrong.

**Expressions follow the conversation, with no extra model calls.** Derive them from events the app already has:

| Moment | Expression |
|---|---|
| Call connects, greeting | Warm smile, small wave |
| Buyer is speaking | Attentive, slight head tilt, eye contact |
| Tool running | Thinking look |
| Showing a highlight or pointing something out | Pointing gesture |
| Offer applied, visit booked | Delighted, thumbs up |
| Something unavailable, a limit reached | Apologetic, small shrug |
| Legal and money explanations | Calm, composed |
| Interrupted | Stops gesture at once, returns to attentive |
| Human advisor takes over | Friendly nod, then standby |

Each tool definition may also carry an optional `tone` argument the model can set, which maps onto the same expression set.

---

## 6. Voice agent

### 6.1 Pipeline

Agora Conversational AI Engine runs the conversation: speech recognition, the language model, and speech output, joined to an Agora RTC channel that the buyer's browser is also in.

- **Speech output: Murf Falcon**, configured as the TTS vendor (`vendor: "murf"`, model `FALCON`, sample rate 24000). Choose an Indian English voice from Murf's voice library that can also speak Hindi words naturally. Voice id, locale, rate and pitch come from configuration.
- **Language model: OpenAI**, through Agora's OpenAI LLM configuration (chat completions endpoint). Model name comes from configuration. Pick a fast tool-calling model and confirm with latency measurements; do not default to the largest model.
- **Speech recognition:** choose from Agora's supported ASR vendors the one that best handles Indian English with Hindi words mixed in. Use Agora's ASR keywords feature to bias recognition toward locality names, project names, and terms such as BHK, Vastu, RERA, Khata, lakh, crore.
- **Language behaviour:** Indian English by default. If the buyer mixes in Hindi, the advisor mirrors that register.

### 6.2 Session start (server side)

1. Server creates a session record and a channel name, and issues RTC and RTM tokens for the buyer (`agora-token`).
2. Server starts the agent with Agora's server SDK (`agora-agents`) or the REST join endpoint (`POST https://api.agora.io/api/conversational-ai-agent/v2/projects/{appId}/join`, Basic auth).
3. The join config is built per session. Sketch of the important parts, to be verified field by field:

```jsonc
{
  "name": "<unique per session>",
  "properties": {
    "channel": "<session channel>",
    "token": "<agent RTC token>",
    "agent_rtc_uid": "<agent uid>",
    "remote_rtc_uids": ["<buyer uid only>"],   // never the human advisor
    "idle_timeout": <seconds>,
    "asr": { /* vendor, language, keywords */ },
    "llm": {
      "url": "https://api.openai.com/v1/chat/completions",
      "api_key": "<from server env>",
      "system_messages": [{ "role": "system", "content": "<section 6.3>" }],
      "greeting_message": "<personalised with the buyer's first name>",
      "failure_message": "<short, in-character>",
      "max_history": <n>,
      "params": { "model": "<from config>" },
      "mcp_servers": [{
        "name": "estates",
        "endpoint": "<PUBLIC_BASE_URL>/mcp",
        "transport": "streamable_http",
        "headers": { "Authorization": "Bearer <per-session token>" },
        "timeout_ms": <ms>
      }]
    },
    "tts": { "vendor": "murf", "params": { /* api_key, voiceId, locale, model FALCON, sample_rate 24000 */ } },
    "advanced_features": { "enable_rtm": true, "enable_tools": true },
    "parameters": { "data_channel": "rtm", "enable_metrics": true, "enable_error_message": true }
  }
}
```

Points that matter:
- **Tools do nothing unless `enable_tools` is on.** Attaching the MCP server alone is silently ignored.
- **MCP transport is `streamable_http` only**, and the endpoint must be reachable from the public internet (deploy the server, or use a tunnel in development).
- **If `allowed_tools` is used, names must match exactly.** A mismatch can hang the agent mid-response with no error. Prefer omitting it.
- **Filler lines:** configure Agora's "talking while waiting" feature with a short static list of natural phrases and a threshold tuned so it only fires when a reply is slow.
- **The per-session bearer token** binds every tool call to its session and keeps the public MCP endpoint closed to others.

### 6.3 System prompt requirements

Write the prompt as a compact brief, not a wall of rules. It must establish:

- **Identity:** a named property advisor for Agora Virtual Estates in Bengaluru. Warm, quick, knowledgeable, never pushy. Says it is an AI advisor if asked.
- **Spoken style:** one to three short sentences per turn, then stop or ask a question. No lists, no markdown, no reading out long numbers digit by digit; say "one point two eight crore".
- **Show, then tell:** whenever the topic changes, call the matching tool first so the screen changes as the answer begins.
- **Grounding:** state a specific fact only if it came from a tool result in this conversation. If the data does not have it, say so and offer to have a human advisor confirm.
- **Screen awareness:** the current view, property and anything the buyer clicked arrive as context each turn. Use it ("the room you just tapped is…").
- **Confirm before acting:** booking a visit, applying an offer, and sending a report need a clear yes.
- **Negotiation:** offer only what the offers policy allows. Past the limit, do not refuse flatly; propose bringing in a senior advisor.
- **Handoff:** hand off when asked for a human, when the buyer is frustrated, or when a request is outside policy.
- **Lead capture:** quietly record needs, budget, timeline, concerns and objections through the lead tool as they come up. Never interrogate.

### 6.4 Keeping the advisor aware of the screen

- When the buyer clicks something, the browser sends a `ui_event` to the server and also sets Agora Signaling presence state for the buyer (active view, property, selected room, slider values). The engine passes presence to the model as context before each LLM call. Verify this mechanism on the "Pass information to the agent" page.
- Every tool result also returns a small `screen` snapshot, so the model's picture of the screen is refreshed whenever it acts.

### 6.5 Tool surface

Implement each tool once as a plain typed function over session state, then expose it through two thin adapters:
- **MCP server** (primary) at `/mcp`.
- **Agora custom HTTP tools** (fallback), where the engine calls an HTTPS endpoint per tool. Same functions, different adapter. Switchable by configuration in case the MCP path misbehaves. Combined tool limit is 32.

Tools must return in well under 100 ms (all data is in memory), keep results small, and never throw; errors come back as a structured result the advisor can speak about gracefully.

| Tool | What it does | Screen effect |
|---|---|---|
| `show_shortlist` | Returns both properties' summary facts | Shortlist view |
| `open_property` | Sets the active property, returns its overview | Property header, default view |
| `tour_go_to` | Moves to a named stop, returns that room's facts | Tour view, camera glide |
| `tour_walkthrough` | Starts or stops the auto walkthrough | Tour view |
| `show_blueprint` | Chooses layer and optional room focus, returns counts | Blueprint view |
| `show_locality` | Chooses category or profile, returns places and facts | Locality view |
| `show_commute` | Routes to a preset or named place, returns distance and time | Commute view |
| `show_compass` | Sets time of day and overlay, returns sunlight and Vastu facts | Compass view, tour lighting |
| `show_money` | Returns breakup, or computes EMI for given inputs | Money view |
| `apply_offer` | Applies an allowed offer after confirmation | Money view total updates |
| `request_discount` | Checks a requested discount against policy | May recommend handoff |
| `show_legal` | Returns a document's status and explanation | Legal view |
| `get_visit_slots` / `book_site_visit` | Lists slots; books after confirmation | Booking view |
| `update_lead` | Records needs, budget, concerns, objections | None (Lead Desk updates) |
| `send_report` | Sends the recap by email and WhatsApp | Activity strip, delivery status |
| `request_human` | Rings the Lead Desk with a reason and summary | Handoff banner |

Keep names and descriptions short and unambiguous; describe when to call each one.

---

## 7. Architecture

```
Buyer browser (React)                    Server (Node)                         Outside
---------------------                    -------------                         -------
Agora RTC  <------ audio ------------------------------------------------>  Agora Conversational AI Engine
Agora RTM  <------ transcripts, agent state, presence -------------------->   (ASR -> OpenAI -> Murf Falcon)
WebSocket  <------ session state ------>  Session store + reducer
                                          Tool functions  <--- /mcp (streamable HTTP) --- engine tool calls
                                          REST: session, token, agent start/stop
                                          Lead store (SQLite)
                                          Report generator ---> OpenAI (summary)
                                          Delivery adapters --> email, WhatsApp
                                          CRM adapter -------> HubSpot (optional)
Advisor browser (/desk) -- WebSocket + Agora RTC (joins same channel on handoff)
```

**One source of truth.** The server holds `SessionState` for each call: active property, active view, view parameters, lead fields, applied offers, EMI inputs, booking, handoff status, event timeline. Every change, whether from a tool call, a buyer click, or the human advisor, goes through one reducer and is broadcast over WebSocket to every client in that session. The buyer screen and the advisor's screen are therefore always in step, and co-browsing comes for free.

**Shared contracts.** `packages/shared` holds Zod schemas and inferred types for `SessionState`, `ViewCommand`, `UiEvent`, every tool's input and output, and every data file. Server, web app, tests and authoring tools all import from it. Nothing crosses a boundary untyped.

**Optimistic and instant.** A view switch renders the moment the state update arrives. All view data is bundled or preloaded, so nothing waits on a request.

**Secrets stay on the server.** The browser receives only short-lived Agora tokens and the map key.

---

## 8. Lead Desk, CRM, reports, human handoff

### 8.1 Lead Desk (`/desk`)

- **Live calls:** active sessions with buyer name, property in view, current view, call length, and a "Join call" button that pulses when a handoff is requested.
- **Leads:** table with name, need, budget, stage, score, last activity.
- **Lead detail:** contact, stated needs, properties and views visited with time spent on each, questions asked, objections, offers shown and applied, EMI inputs, booking, full transcript, AI-written summary, and delivery log.
- **Outbox:** every email and WhatsApp message with its real status and a preview.

**Lead score** is rule-based and explainable (for example: visit booked, time on money view, offer applied, timeline stated). Show the reasons next to the score. Weights live in a config file.

**Storage:** SQLite on the server (Node's built-in `node:sqlite`). **External CRM:** a `CrmAdapter` interface with a HubSpot implementation (free CRM, private-app token) that upserts the contact, creates a deal, and attaches the summary as a note. It runs when its token is configured; the Lead Desk works without it.

### 8.2 Reports

When the call ends, or when the buyer asks, the server produces a recap: a structured summary generated by OpenAI from the transcript and the event timeline (structured output validated with Zod), rendered into a clean branded HTML email and a short WhatsApp message.

- **Email:** `EmailAdapter` with one real provider (a transactional email API free tier, or SMTP). Attach an `.ics` file when a visit is booked.
- **WhatsApp:** `WhatsAppAdapter` with one real provider (Twilio's WhatsApp sandbox or Meta's WhatsApp Cloud API test number). Confirm current free-tier limits and recipient opt-in rules before choosing.
- **Always record to the Outbox.** If a provider fails or is not configured, the status says so. Never display "sent" for something that was not sent.

### 8.3 Human handoff

1. Trigger: the buyer presses "Talk to a human", asks for one, or the advisor calls `request_human`.
2. The Lead Desk rings. The buyer sees "Connecting you to a senior advisor" while the AI keeps the conversation going.
3. The human clicks Join. Their browser joins the same Agora channel and publishes microphone (and camera, optionally). A new tile appears on the buyer's screen with their name and a "Human advisor" label.
4. The AI says one handover line, then goes to standby. Stop the agent session at that point; the avatar tile shows "Standing by".
5. The human sees the full context panel and can switch views and properties for the buyer with the same controls.
6. "Hand back to the AI advisor" restarts the agent with a short context summary added to its prompt, so it picks up where things stand.

The agent only ever subscribes to the buyer's audio, so it never responds to the human advisor.

---

## 9. Data and content

All product content lives in validated data files under `data/`. No property fact, price, label or coordinate is written inside a component. Components render whatever the data says, so adding a third property later means adding files, not code.

```
data/
  properties/<id>/
    property.json     identity, type, locality, coordinates, north offset, entrance direction, highlights, credits
    rooms.json        rooms: name, polygon (model X/Z), area, features
    tour.json         stops: room, camera position, look-at target, facts, order
    plan.json         layers: electrical points and circuits, plumbing lines and fixtures
    money.json        sale: line items, rates, schedule, offers  |  lease: rent, deposit, terms
    legal.json        documents: type, status, reference, plain-language explanation
    visits.json       site-visit slots
  localities/<id>.json  profile, places by category, sources
  commute/<propertyId>.json  preset routes: geometry, distance, duration
  policy/offers.json    what the advisor may offer, discount limit, handoff threshold
  policy/scoring.json   lead score weights
```

Rules for authoring content:

- **The data must describe what is visibly in the model.** Open each model, list the real rooms and features, and write facts from that. Do not claim a balcony, a second bedroom, or a view that the model does not show.
- **Fictional projects in real places.** Use invented project and builder names, and check by web search that they do not match a real Bengaluru project. Place each property at a real point in a real locality (for example an inner-east residential locality for the apartment and a startup district for the office), so maps and routes are real.
- **Locality places are real and fetched, not invented.** Write a script that pulls places around each property from OpenStreetMap and stores them with names, coordinates and categories. Review the result and trim it. Show OpenStreetMap attribution.
- **Locality profile notes are researched.** Write them from sources you looked up, keep the source links in the file, and keep claims modest.
- **Commute routes are precomputed** for the presets with an open routing service and committed. Custom destinations are geocoded and routed live, with a timeout and a graceful "I couldn't work that route out" path.
- **Money is computed, never typed.** Totals, taxes and EMI come from line items and rates through tested functions. Look up current stamp duty, registration and tax rates for Karnataka from official sources, store them as named configuration, and label the result an estimate.
- **Legal references are plainly fictional** and the view is labelled as sample documents.
- **Sunlight is computed** from the property's coordinates, north offset, date and time with a sun-position library. Vastu verdicts come from a small rule table applied to each room's direction.
- **Blueprint layers follow building logic:** plumbing connects wet areas to a shaft; the distribution board sits near the entrance; switchboards sit beside doors; every room has light points and sockets; AC points sit on external walls.

---

## 10. 3D pipeline

**Source models** (downloaded by the owner into `assets/models/raw/`, glTF or GLB):

| Use | Model | Author | Licence | Notes |
|---|---|---|---|---|
| Property A | Modern Apartment | Visthétique | CC BY 4.0 | About 3M triangles. Must be optimised. |
| Property A fallback | apartment floor plan | SrMonteiro | CC BY 4.0 | 133.8k triangles, baked lighting, likely open-top |
| Property B | Loft 18 mini office (environment version) | dasy444 | Sketchfab "Free Standard" | 116.3k triangles, includes street view outside the window |
| Spare | Loft 17 interior, view of the city | dasy444 | CC BY 4.0 | 45.4k triangles, multi-floor |
| Spare | Low Poly House Interior | Paolo Mercogliano | CC BY 4.0 | 72.9k triangles, two floors |

If a raw model is missing, build with a stand-in and keep going; do not block other work.

**Steps**

1. **Inspect** each model: node tree, named objects, materials, textures, scale, up axis, whether furniture is separate, whether walls are single-sided. Write the findings to a short notes file per model.
2. **Optimise** with glTF-Transform: deduplicate, prune, weld, simplify heavy meshes, Meshopt compression, textures resized and converted to a GPU-friendly compressed format. Target a file that loads from local disk in about a second and renders at a steady 60 fps on a mid-range laptop GPU. Compare before and after screenshots; if Modern Apartment loses visible quality, back off the simplification before considering the fallback model.
3. **Normalise**: metres, Y up, origin at floor centre, and record the rotation that aligns model north with true north.
4. **Render**: React Three Fiber, one persistent canvas, an environment map for reflections, tone mapping, soft shadows only if they hold frame rate. Fix one-sided walls with double-sided materials where needed. Render on demand when nothing is moving.
5. **Camera**: a camera-controls rig with smooth eased moves between shots, collision-free paths (move through doorways via intermediate points where a straight line would cut through a wall), and limited free-look at each stop.
6. **Author shots** in `/studio` (section 14): fly freely, frame a view, press a key to save position, target, field of view and room into `tour.json`.
7. **Plan base image**: render each model top-down with an orthographic camera and a clipping plane at about chest height, so ceilings and upper walls are cut away. This image, restyled as a blueprint, sits under the vector layers in the Blueprint, Compass and mini-map views, so 2D and 3D always line up. Room polygons and layer points are stored in the same model coordinates.
8. **Hero images** for shortlist cards are captured from saved shots, not sourced elsewhere.
9. **Lighting by time of day**: the tour's key light direction and warmth follow the Compass view's time. Where a model has baked lighting, shift exposure and tint instead.

Preload both models while the call is ringing, so the first tour opens instantly.

---

## 11. Design system

> The owner will supply a visual reference and a logo. When they arrive, the reference overrides the defaults in this section wherever they differ.

**Brand:** Agora Virtual Estates. The logo is a mascot built on a lowercase "a", supplied by the owner in `assets/brand/`. Do not download or redraw any official third-party logo. Until the files arrive, use a neutral stand-in component with the same API so swapping is a file change.

**Character:** bright, friendly and confident. White canvas, Agora blue as the anchor, a handful of vivid accents used with intent. It should feel like a well-made consumer product with personality, not a dashboard and not a template.

**Colour tokens** (starting point; confirm the blue against the owner's reference):

| Token | Value | Use |
|---|---|---|
| `canvas` | `#FFFFFF` | Page background |
| `ink` | `#0E1726` | Text, outlines |
| `ink-soft` | `#5B6677` | Secondary text |
| `line` | `#E6EAF0` | Hairlines |
| `blue` | `#099DFD` | Primary actions, active state, brand |
| `blue-deep` | `#0B6FD6` | Pressed, text on tint |
| `blue-tint` | `#E8F5FF` | Soft fills |
| `sun` | `#FFC93C` | Sunlight and compass, highlights |
| `coral` | `#FF6B5E` | Money, offers, alerts |
| `mint` | `#1FC98E` | Confirmations, verified |
| `grape` | `#7B61FF` | Blueprint and technical layers |
| `tangerine` | `#FF8A1F` | Locality and commute |

Each view owns one accent, used on its dock chip, its header mark and its key highlights. That makes the dock a colourful, readable map of the product rather than decoration.

**Type:** one expressive display face for headings and big numbers, one clean humanist sans for interface text, and tabular figures for money. Suggested default: Bricolage Grotesque for display and Plus Jakarta Sans for text, self-hosted. Replace with the faces in the owner's reference.

**Shape and depth:** solid fills, generous radii, a confident ink outline on key cards and chips, and a hard offset shadow rather than a soft blur. Stickers, tags and the mascot bring the playfulness; the layout itself stays calm and aligned to a spacing scale.

**Motion:** quick and purposeful. Views cross-fade with a slight slide; chips and tiles respond on press; numbers count to their new value when an offer or slider changes them; the mascot reacts to state. Nothing loops for attention. Respect reduced-motion settings.

**Mascot moments:** ringing screen, listening and thinking states, empty and error states, the handoff banner, and the summary screen.

**Hard rules: nothing that reads as generated filler.**
- No gradient text, gradient buttons, or purple-to-blue washes.
- No glass blur cards, glow effects, or floating blobs.
- No emoji used as icons. One icon family, one stroke weight.
- No lorem ipsum, no "feature one, feature two" cards, no invented testimonials or statistics.
- No marketing clichés in copy. Write plain, specific sentences a property advisor would say.
- No framework-default look: no default greys, default shadows or default font stack.
- No shimmer skeletons for data that is already local.
- Every number is real, computed, and formatted for India.
- Every state is designed: loading, empty, error, permission denied, offline.

---

## 12. Performance budgets

| What | Budget |
|---|---|
| View switch, from state update to painted | Under 150 ms |
| Tour frame rate | Steady 60 fps on a mid-range laptop |
| Tool function execution | Under 100 ms |
| First tour open after call connects | Instant (models preloaded during ringing) |
| Voice round trip, buyer stops to advisor starts | As low as the pipeline allows; measure with engine metrics and tune model choice, prompt size, history length, and tool result size |
| Camera move between stops | Smooth and eased, never a cut |

Practices: keep the 3D canvas mounted and hidden rather than remounted; load the map library lazily but before it is first needed; keep the system prompt and tool results compact; cap conversation history; avoid layout shift when views change; test with the network throttled.

---

## 13. Reliability

- **No dead ends.** Every click and every voice request leads somewhere sensible. If a thing is not available, the advisor says so and offers the nearest alternative.
- **Graceful degradation, in order:** 3D avatar fails → mascot presence. Live route fails → advisor says it could not compute it and shows presets. Map tiles fail → fall back to a second tile source. Delivery provider fails → Outbox shows the failure and offers retry. Microphone blocked → typed input with the same advisor.
- **Agent failure:** listen for engine error events; show a calm "reconnecting" state and restart the agent with the session context restored from server state.
- **Interruption:** when the buyer cuts in, stop gestures and any auto walkthrough immediately.
- **Audio in noisy rooms:** follow Agora's audio setup guidance (echo cancellation, noise suppression); recommend a headset; make sure the advisor's own voice from speakers does not trigger it.
- **Presenter controls:** number keys switch views and a key toggles the property, working through the same state reducer, so a live demo can always be steered by hand. They are silent; no on-screen indicator.
- **Reset:** one command restores seed data and clears sessions and leads, so a run can start clean every time.
- **Engineering standards:** strict TypeScript, no magic numbers (named configuration), no content hardcoded in components, small modules, errors handled where they occur, meaningful logs on the server with session ids, and no secrets in the client bundle or the repository.

---

## 14. Developer tooling (`/studio` and scripts)

These exist so the product can be built and tested without spending live voice minutes on every change.

- **Director:** buttons and a command box that fire the same tool functions the advisor uses, against a local session. Every view and state can be driven by hand.
- **Simulated advisor:** a text chat that runs the real system prompt and real tool definitions directly against the language model, with no voice. Use it to tune the prompt and tool descriptions.
- **Conversation evals:** scripted buyer lines for the golden path and for edge cases, run through the simulated advisor, asserting which tools are called with which arguments and that no ungrounded numbers appear. Run on every prompt or tool change.
- **Shot capture:** free-fly camera in a model with save, reorder, preview and export to `tour.json`.
- **Plan editor:** the top-down image with tools to draw room polygons, drop electrical and plumbing symbols, and draw runs, exporting to `rooms.json` and `plan.json`. Draft these files from the model first, then correct them here.
- **Scripts:** optimise models, render plan images and hero shots, fetch locality places, precompute routes, reset demo data.
- **Tests:** unit tests for money, EMI, sun and Vastu logic and the state reducer; contract tests for every tool; browser checks that drive each view through the Director and check for console errors and missing content; a full golden-path run with the simulated advisor.

---

## 15. Stack and repository

**Web:** React, TypeScript, Vite, Tailwind CSS with the tokens from section 11, a small state store (Zustand), an animation library (Motion), React Three Fiber with drei and camera-controls, MapLibre GL, a sun-position library, Zod. Agora Web SDKs: `agora-rtc-sdk-ng` and `agora-rtm-sdk`, plus Agora's Conversational AI web toolkit for transcripts and agent state events if it is published as a package.

**Server:** Node, TypeScript, Fastify, WebSocket, the Model Context Protocol TypeScript SDK (streamable HTTP transport), `agora-agents`, `agora-token`, `node:sqlite`, OpenAI SDK, Zod.

**Maps:** MapLibre with a satellite-capable tile provider that has a free tier, and a second source as fallback. Open routing and geocoding services for commute. Confirm each provider's current free-tier terms and attribution requirements.

Use current stable releases and pin them.

```
apps/web/            buyer app, Lead Desk, studio
apps/server/         API, MCP server, session store, adapters
packages/shared/     schemas, types, tool definitions, formatting (money, distance)
data/                all content (section 9)
assets/models/raw/   source models (owner supplies)
assets/brand/        logo and mascot (owner supplies)
scripts/             pipeline and maintenance scripts
```

**Configuration** (server environment unless marked):

| Variable | Purpose |
|---|---|
| `AGORA_APP_ID`, `AGORA_APP_CERTIFICATE` | Tokens |
| `AGORA_CUSTOMER_ID`, `AGORA_CUSTOMER_SECRET` | REST authentication |
| `OPENAI_API_KEY`, `LLM_MODEL` | Language model |
| `MURF_API_KEY`, `MURF_VOICE_ID`, `MURF_LOCALE` | Voice |
| `ASR_VENDOR` and its key if needed | Speech recognition |
| `PUBLIC_BASE_URL` | Publicly reachable server URL for tool calls |
| `TOOL_TRANSPORT` | `mcp` or `http` |
| `AVATAR_MODE` (web) | `human3d` or `mascot` |
| `MAP_TILES_KEY` (web) | Map provider |
| Email provider settings | Reports |
| WhatsApp provider settings | Reports |
| `HUBSPOT_TOKEN` | Optional CRM sync |

Provide an `.env.example` with every variable described and no real values.

---

## 16. Parallel work plan

**Foundation, done first by the lead agent:**
1. Repository, tooling, lint and strict TypeScript.
2. `packages/shared`: all schemas, `SessionState`, `ViewCommand`, `UiEvent`, tool input and output types.
3. Server skeleton with the session store, reducer and WebSocket broadcast.
4. Web skeleton with routing, the design tokens, the call screen shell, and a view registry where each view is a module with the same interface.
5. Seed data stubs that validate against the schemas.
6. The Director, so every later workstream can test in isolation.

**Then in parallel, each with its own directories and the shared contracts as the only coupling:**

| Workstream | Owns |
|---|---|
| Voice | Token service, agent start and stop, join config, prompt, RTC and RTM client, captions, agent state |
| Tools | Tool functions, MCP adapter, HTTP adapter, contract tests, simulated advisor, evals |
| 3D | Model inspection and optimisation, tour view, camera rig, shot capture, plan and hero renders |
| Plans | Blueprint view, Compass view, plan editor, sun and Vastu logic |
| Maps | Locality view, Commute view, place fetching, route precompute |
| Money and Legal | Both views, money engine, offers policy, booking view |
| Presence | Avatar integration, mascot component, expression mapping |
| Desk | Lead store, Lead Desk, scoring, reports, delivery adapters, CRM adapter, handoff |
| Design | Component library, landing, ringing, summary, motion, every empty and error state |
| Content | All data files for both properties, checked against the models |

**Integration and verification, back with the lead agent:**
- Wire the real voice session to the views end to end.
- Run the golden path by voice and fix everything that stutters.
- Have a fresh sub-agent that has not seen the code review it for correctness, and another walk every screen with screenshots and judge it against section 11.
- Run the full test suite and the performance budgets.

---

## 17. Acceptance checklist

- [ ] The whole golden path in section 2 runs by voice for Property A, start to summary, with no error, no stall and no placeholder.
- [ ] The same path runs for Property B with the lease variants.
- [ ] Every view can be reached by voice, by click, and by presenter key, and the advisor stays aware in all three cases.
- [ ] The buyer can interrupt the advisor mid-sentence in every view and it responds to the new request.
- [ ] No spoken or displayed number lacks a source in the data files.
- [ ] Booking, applying an offer and sending a report each wait for an explicit yes.
- [ ] A discount request beyond policy leads to an allowed alternative and a handoff offer.
- [ ] A human advisor can join, be heard, drive views, and hand back to the AI.
- [ ] The lead appears in the Lead Desk with timeline, score with reasons, transcript and summary.
- [ ] The recap email and WhatsApp message arrive, and the Outbox shows true statuses.
- [ ] The avatar lip-syncs acceptably and changes expression with the moments in section 5, or the mascot fallback is active and polished.
- [ ] All performance budgets in section 12 are met.
- [ ] No console errors or warnings during a full run.
- [ ] Every screen holds up against the hard rules in section 11.
- [ ] Model credits, map attribution and sample-data labels are visible where required.
- [ ] A clean reset followed by a full run works twice in a row.

---

## 18. Inputs needed from the owner

| Input | Used for | If missing |
|---|---|---|
| Visual reference (colours, fonts, style) | Section 11 | Use the defaults in section 11 |
| Logo and mascot files | Brand, mascot presence | Neutral stand-in component |
| 3D models downloaded into `assets/models/raw/` | Section 10 | Stand-in model; tour authoring waits |
| Agora App ID, certificate, REST credentials | Voice | Voice blocked; everything else proceeds with the simulated advisor |
| Murf API key and chosen voice | Voice | Same as above |
| OpenAI API key | Advisor, reports | Blocked for advisor logic |
| Map provider key | Maps | Fallback tile source |
| Email and WhatsApp provider accounts | Reports | Outbox records "not configured" |
| HubSpot token | CRM sync | Lead Desk only |
| Confirmation that the "Free Standard" licence allows serving the office model from a website | Property B | Switch to a CC BY office model |

---

## 19. Reference documentation

Agora Conversational AI
- Overview: https://docs.agora.io/en/ai.md
- Build a backend and client from scratch: https://docs.agora.io/en/ai/build/build-server-client.md
- Start and stop an agent: https://docs.agora.io/en/ai/build/start-stop-agent.md
- Use MCP tools: https://docs.agora.io/en/ai/build/tools/mcp-tools.md
- Call custom tools: https://docs.agora.io/en/ai/build/tools/custom-tools.md
- Display live transcripts: https://docs.agora.io/en/ai/build/transcripts.md
- Client-side events: https://docs.agora.io/en/ai/build/handle-runtime-events/event-notifications.md
- Notification event types: https://docs.agora.io/en/ai/reference/event-types.md
- Pass information to the agent: https://docs.agora.io/en/ai/build/shape-the-conversation/custom-information.md
- Talking while waiting: https://docs.agora.io/en/ai/build/shape-the-conversation/filler-words.md
- Interrupt the agent: https://docs.agora.io/en/ai/build/shape-the-conversation/interrupt-agent.md
- Improve ASR accuracy with keywords: https://docs.agora.io/en/ai/build/shape-the-conversation/asr-keywords.md
- Optimize latency: https://docs.agora.io/en/ai/best-practices/optimize-latency.md
- Optimize audio quality: https://docs.agora.io/en/ai/best-practices/audio-setup.md
- Get agent state: https://docs.agora.io/en/ai/best-practices/get-agent-state.md
- Debug agent failures: https://docs.agora.io/en/ai/build/handle-runtime-events/debug-agent-failures.md
- OpenAI LLM: https://docs.agora.io/en/ai/models/llm/openai.md
- Murf TTS: https://docs.agora.io/en/ai/models/tts/murf.md
- ASR vendors: https://docs.agora.io/en/ai/models/asr/ares.md (and sibling pages)
- Avatar vendors (hosted alternative): https://docs.agora.io/en/ai/models/avatar/anam.md
- API reference: https://docs.agora.io/en/api-reference/conversational-ai
- Full page index: https://docs.agora.io/llms/doc-versions-convoai-guides-v1.txt

Murf
- API overview: https://murf.ai/api/docs/introduction/overview
- Falcon model: https://murf.ai/api/docs/text-to-speech-models/falcon-2.md

Avatar
- TalkingHead: https://github.com/met4citizen/TalkingHead
- HeadAudio: https://github.com/met4citizen/HeadAudio
- HeadAudio on a live voice agent (example): https://met4citizen.github.io/HeadAudio/openai.html

3D models
- Modern Apartment: https://sketchfab.com/3d-models/modern-apartment-1fbb649cd6624f2bb7b7d6e30c6533a5
- apartment floor plan: https://sketchfab.com/3d-models/apartment-floor-plan-2e85bf66e2dd4d48b683d6843e040a2b
- Loft 18 mini office (environment): https://sketchfab.com/3d-models/loft-18-mini-office-venvironment-00f610a2e4504ba59aad766e705c395e
- Loft 17 interior: https://sketchfab.com/3d-models/free-loft-17-interior-floors-view-of-the-city-1bc27584241b4078975b31dd4610d6e0
- Low Poly House Interior: https://sketchfab.com/3d-models/low-poly-house-interior-62b1714ef66f4e0d9f42dcd12efb3f52

---

## 20. Deliberately out of scope

- Real phone calls over the telephone network.
- Automatic conversion of an uploaded floor plan into a 3D model.
- A builder-side listing portal.
- Real payments or unit holds.
- Mobile layouts.
- More than two properties.
- Furniture restaging inside the 3D model.

These are natural next steps; the data-driven structure in section 9 leaves room for them.

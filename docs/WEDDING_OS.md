# Wedding OS: baseline and Milestone 1

Branch: `feat/wedding-os` (from `main` @ `518a94c`). Toolchain: Node 22.22.2, pnpm 12.18.0 (corepack), TypeScript 7.0.2.

## Milestone 0: baseline (before any change)

| Check | Result |
|---|---|
| `pnpm install --frozen-lockfile` | OK (379 packages, ~65 s) |
| `pnpm typecheck` | OK, all 4 workspaces |
| `pnpm test` | **471 passed** (shared 112, web 93, server 266; 46 files) |
| `pnpm build` | OK (Vite chunk-size warning only) |
| Server start with no keys | OK; `/api/health` reports every integration `false` |

The original app runs fully without any API key. Voice needs Agora, OpenAI, Murf and a public HTTPS URL; none were exercised.

## Milestone 1: what exists now

**Shared (`packages/shared/src/wedding/`)**
- `state.ts`: zod `WeddingState` (profile, venue, decoration scene, budget, vendor shortlist, outfits). Money is whole rupees.
- `actions.ts`: `WeddingActionSchema` + `applyWeddingAction`, the only way state changes. Invariants live here: allocations never exceed the total, the total never drops below what is allocated, a venue must hold the guest count, expense ids are unique. `CLIENT_ALLOWED_ACTIONS` is the subset a browser may send.
- `budget.ts`: deterministic `suggestAllocation` (largest-remainder, always sums exactly), `summarizeBudget`, `formatInr`.
- `tools.ts`: zod contracts and descriptions for 9 planner tools.
- `sample.ts`: sample venues and vendors, every one `source: 'sample'`, plus `SAMPLE_DATA_NOTICE`.

**Server (`apps/server/src/wedding/`)**
- `store.ts`: in-memory workspaces persisted to `apps/server/var/weddings/<id>.json` (gitignored); files are re-validated on load and quarantined if invalid; ids are restricted to `[A-Za-z0-9_-]{1,64}`.
- `tools.ts`: *(replaced in milestone 3 by `toolkit.ts`, `specialists/` and `orchestrator.ts`; see below).*
- `planner.ts`: with `OPENAI_API_KEY` it reuses the existing `runToolLoop` / `openAiChat` from `agent/sim.ts`; without a key it falls back to `demoParser.ts` *(replaced in milestone 3 by `demo.ts`)*. The two paths share the executor and reducer.
- `routes.ts`: `GET /api/wedding-meta`, `GET /api/wedding/:id`, `POST .../actions` (client-allowed actions only, 403 otherwise, 422 on invariant failure), `POST .../chat`, `POST .../reset`.

**Web (`apps/web/src/wedding/`)**: shell with the six-item navigation, Dashboard (editable profile, budget stats, venue picker), AI Planner chat (shows each tool call and whether it succeeded), Budget Planner (total, guideline split, per-category table, expenses). Studio, Vendors and Try-On are labelled placeholders. Legacy real-estate screens moved to `/legacy`, `/call/*`, `/desk/*`.

## Known limits (honest list)
- **No login.** A workspace is a random id in `localStorage`; anyone holding the id can read and change it. Demo-grade. Real auth is milestone 9.
- **Planner in LLM mode is untested against a live model.** Its tool loop is covered with a scripted mock provider only; the demo path was exercised live.
- **Correction (found in milestone 3):** the milestone 1 AI Planner page crashed in current Chrome (`useEffect` returning the Promise from `scrollIntoView`). Typecheck, tests and build did not catch it because nothing had opened the page in a browser. Fixed in milestone 3; every page is now opened in headless Chrome and checked for console errors.
- **Demo parser is rule-based** and understands a handful of phrasings (see `DEMO_HELP`).
- **UI checks:** Milestone 1 was verified by typecheck, build and API-through-proxy only. Milestone 2 was additionally driven in headless Chrome (see below). The dashboard, planner and budget pages have still not been looked at in a browser.
- **Rose re-theme** changes the `--color-blue*` token values, which also recolours the legacy screens and the mascot-based components; those were not reviewed visually.
- Legacy real-estate code (tools, voice, desk, 3D tour) is still in the tree and still tested; nothing wedding-related uses it yet except the LLM loop helpers.
- Decoration scene schema exists but no actions modify it yet (milestone 2).


## Milestone 2: 3D Wedding Studio

**Shared scene domain (`packages/shared/src/wedding/scene/`)**
- `geometry.ts`: polygon rooms, point-in-room, wall-crossing, separating-axis overlap. Ported from room-configurator (`room.ts`, `catalog.ts`); angles are radians and follow Three.js `rotation.y`, so collision footprints match what is drawn.
- `placement.ts`: add / move / rotate / scale / duplicate / remove / recolour, grid snapping (10 cm), wall-flush snapping (15 cm), nearest-free-spot search. Ported from room-configurator (`placeItem`, `snapPosition`, `moveItem`) and extended with four mounts: **floor**, **stage** (sits on top of a wedding stage; a stage carries what stands on it when moved and cannot be removed, turned or resized while it holds objects), **wall** (flush, faces into the room, cannot be turned) and **ceiling** (hangs from the ceiling). Objects collide only within their own mount layer and height range.
- `catalog.ts`: 11 data-driven entries (traditional and modern mandap, stage, flower arch, flower arrangement, floral wall panel, chair, sofa, chandelier, fairy-light curtain, floor lantern).
- `rooms.ts`: plan data for two sample venues; the studio shows the selected venue if it has a room, otherwise the sample ballroom.
- `actions.ts`: 13 scene actions, applied only through `applyWeddingAction`. Undo/redo history (30 steps) and saved designs (20) live in `WeddingState`, so every client and, from milestone 3, every agent tool shares one history. Switching venue is refused if the decorations would not fit the new room.
- `serialize.ts`: versioned scene file (`version: 1`) with a v0 migration; refuses newer versions and malformed input.
- Older saved workspaces still load: the new fields have defaults.

**Web (`apps/web/src/wedding/studio/`)**: the venue (`VenueModel.tsx`, built from plan data, a separate group from decorations) and the decoration layer are both redrawn from `WeddingState`. Models are procedural (`models.tsx`), each mesh with its own material, so recolouring one object cannot affect another. Pointer-event drag (mouse and touch) with a live valid/invalid preview; buttons for rotate, size, nudge, colour swatches plus a picker, duplicate, delete, undo/redo, save/load/delete designs; Delete and Cmd/Ctrl+Z shortcuts. The page is lazy-loaded.

**Verification:** `pnpm typecheck`, `pnpm test` (541 tests: shared 159, web 93, server 289) and `pnpm build` pass. The acceptance flow (open studio, add mandap, drag, rotate, recolour, add chairs and arrangements, undo, save, reload, load) was run in headless Chrome against the real dev servers and every step passed against server state. A second run exercised every mount type in the real UI.

**Known limits**
- Models are simple procedural shapes, not licensed GLB assets. Adding a GLB means a new builder in `models.tsx` plus a catalogue entry.
- The cutaway venue hides the walls facing the camera, so a wall decoration on a hidden wall looks like it is floating until you orbit inside.
- Rotation is in 15 degree steps from the buttons (the domain accepts any angle); there is no on-canvas rotate handle, and scale is by buttons, not a handle.
- Only two sample venues have a 3D room; the lakeside lawn falls back to the ballroom.
- Not tested: a real phone or tablet (touch is covered by pointer events only), and Safari/Firefox.
- Design export/import files exist in the domain (`serialize.ts`) but there is no UI for them yet.
- AI changes to the scene are milestone 3.


## Milestone 3: the planner drives the studio and the budget

**Architecture.** One executor, two ways of choosing tool calls.
- *Specialist modules* (`apps/server/src/wedding/specialists/`): **Venue and details** (`venue.ts`), **Decoration** (`decoration.ts`), **Budget** (`budget.ts`). Each is a list of tools: name, description for the model, zod input, a progress label, and a `run` that changes the wedding only by dispatching validated actions through the store and so the shared reducer. They are function-call modules, not independent autonomous agents.
- *Orchestrator* (`orchestrator.ts`): a dispatcher with memory. It owns the specialist list, validates and runs tool calls, and records what each call changed (objects touched, scene steps per request) so later messages can resolve "it" and "undo that".
- *Planner* (`planner.ts`): **live path** passes every tool schema to the model and runs its calls one after another with the existing `runToolLoop` (up to 14 rounds; provider still behind `ChatCreate`). **Demo path** (`demo.ts`) is a rule-based router that picks tools from plain requests and splits compound ones ("change the flowers to white and add more arrangements"). Both go through the same `exec`, which emits `tool_start` / `tool_end` progress events. The demo router contains no business logic: placement, collision, stage support, costs and limits all live in `@ave/shared`.
- The model sees, every round: the real scene (ids, mounts, positions), the studio selection, what was just changed, whether the last request can be undone as a unit, and the budget.

**Tools** (all return `{ok, summary, data}` or `{ok:false, error, hint}`):

| Specialist | Tools |
|---|---|
| Decoration | `listDecorationAssets`, `listSceneDecorations`, `addDecoration`, `moveDecoration`, `rotateDecoration`, `scaleDecoration`, `changeDecorationMaterial`, `duplicateDecoration`, `removeDecoration`, `undoDecorationAction`, `saveWeddingDesign`, `loadWeddingDesign` |
| Budget | `getBudgetSummary`, `setTotalBudget`, `allocateBudget`, `setBudgetLimit`, `estimateDecorationCost`, `addExpense`, `checkBudgetFeasibility` |
| Venue | `getWeddingOverview`, `updateWeddingProfile`, `listVenues`, `selectVenue` |

**Shared-domain additions** (`packages/shared`)
- Sample prices on every catalogue entry (`samplePrice`, e.g. traditional mandap ₹75,000, flower arrangement ₹12,000, flower arch ₹18,000, chandelier ₹25,000) with `PRICE_NOTE` ("not vendor quotations"). `scene/cost.ts`: `sceneCost`, `costLines`, `suggestTrim` (removes least-essential pieces first; never the stage or a mandap).
- `scene/colors.ts`: named colours (pink, gold, white/jasmine, yellow, warm …). The model never invents hex values.
- Atomic batch actions, each a single undo step: `add_decors`, `remove_decors`, `set_decor_colors`. New `budget.limits` and the `set_budget_limit` action.
- **The customer's decoration limit is enforced in the reducer** for adds and duplicates, so a tool, the model or a browser client cannot skip it. Only an explicit `acceptOverBudget` lets one through, and only a confirmed proposal sets it. *(The model-facing `customerAcceptedOverBudget` flag was removed; see "Milestone 3 hardening".)*

**Behaviour that matters**
- "Undo that" uses `undoDecorationAction({lastRequest: true})`: it undoes every scene change the previous request made, but only if the scene is exactly as that request left it. If the customer edited by hand since, only the latest change is undone and the result says why.
- Changing an existing total, allocation or limit by more than 10% (raising a limit, or changing a total or allocation either way) no longer applies directly: it becomes a **proposal** the customer confirms with a button. *(Replaced the model-settable `confirmed` flag; see "Milestone 3 hardening" below.)*
- Lowering the limit below the current scene makes the demo router remove the least-essential pieces to fit, report exactly what it removed, and offer undo.
- New flower arrangements inherit the flower colour the scene already uses.
- Chat: `POST /api/wedding/:id/chat` accepts `selectedId` (checked against the scene) and `stream: true` for newline-delimited progress events. The web client redraws the 3D scene from the state attached to each `tool_end`, so the venue changes as each action is accepted. The chat is in a tab beside the 3D studio and on the Planner page; the Budget page has a decoration-limit control.

**Tests (all passing):** `packages/shared` 171, `apps/web` 93, `apps/server` 321 (585 total; 471 at the start of milestone 0). New: `planner.test.ts` (55 with `wedding.test.ts`) and `scene/agent-actions.test.ts`, covering adding a mandap by tool, changing only flower colour, moving a selected object, missing objects, invalid placement, undoing agent changes (single and whole-request), saving and reloading an agent-made design, cost calculation, breaching a constraint (including forged flags and direct reducer calls), multi-step requests A–E and the South Indian theme, demo and mocked-live paths, and streaming. `pnpm typecheck` and `pnpm build` pass.

**Browser acceptance (headless Chrome, real servers, demo mode):** the four-message conversation passed against server state, with screenshots after each message: (1) "Create a traditional South Indian wedding with a gold mandap and yellow flowers" builds stage, mandap on the stage, arch, 2 arrangements, 4 chairs, wall panel, gold and yellow; (2) "Change the flowers to white and add more arrangements" recolours only flower parts and adds 2 white arrangements (₹2,18,400 sample estimate); (3) "Keep the decoration budget below ₹2 lakhs" records the limit and removes the floral wall panel and one arrangement (₹1,91,400), explaining both; (4) "Undo the last change" restores the previous scene exactly. All routes were also opened and checked for console errors. These scripts are not in the repo.

**Known limits**
- **The live model path has never run against a real model** (see the hardening section: the attempt could not be made because no key was available).
- ~~Confirmation flags are model-settable.~~ **Fixed in the hardening pass below.**
- **The limit also applies to hand edits.** With a limit set, adding from the studio past it is refused with an explanation; raise or remove the limit on the Budget page.
- **Demo mode is a rule-based router**, not understanding: it handles the phrasings in `DEMO_HELP` and says "not supported" otherwise. Pronouns resolve to the studio selection, else what was changed last; several matches without a selection get a clarifying refusal.
- **"Warm lighting"** is done by colouring chandeliers and lanterns warm; there is no global lighting control, and the planner says so.
- **Planner memory is in the server process** (conversation history, "recently changed", last-request undo); it is lost on restart. The wedding itself persists.
- **Redo is not a chat tool** (use the Studio's Redo button). There is still no login; workspaces are keyed by a browser-held id.
- Sample prices are demonstration data. Every vendor, venue and price is labelled sample; there is no real pricing source.
- Not done in this milestone, by instruction: virtual try-on, vendor discovery, Flagsmith, Sarvam, NudgeBee.

**Next: Milestone 4**: vendor discovery with clearly labelled sample vendors (and a Vendor specialist module using the same toolkit), virtual outfit try-on (`try-on` package), then the sponsor integrations, plus one run of the live model path against a real key.


## Milestone 3 hardening: customer confirmation, and the live-model check

### What was tested live and what was not

| Check | Provider | Status |
|---|---|---|
| Live model tool-calling smoke test (5 requests) | real OpenAI | **NOT RUN.** No `OPENAI_API_KEY` exists on this machine (not in the shell, no `.env` in the repo). I did not borrow a key from any other project. **No claim of a live pass is made anywhere in this document.** |
| The smoke-test harness itself | scripted mock (`--mock`) | Run, to check the harness. First with deliberately lazy mock replies: it correctly **failed** them (reply named no catalogue items; reply said "₹0" when the code-computed estimate was ₹2,56,000). Then with truthful replies: all checks passed. This validates the harness only. |
| Confirmation workflow, forged flags, replay, expiry, cancel, workspace mismatch, tampering | no model: direct calls, mocked providers, real HTTP routes, real browser | Tested (below). |
| Demo mode without an API key | none | Tested in the real browser: original acceptance conversation and the confirmation flow both pass with no key. |
| Live-model *tool loop mechanics* (sequential calls, history, errors) | scripted mock provider | Tested in unit tests. This is not evidence about how a real model behaves. |

To run the live test (about five requests, a few cents):

```
export OPENAI_API_KEY=...            # or put it in .env (gitignored); it is only ever read server-side
pnpm --filter @ave/server wedding:smoke
```

It builds a dedicated in-memory workspace (nothing touches a real wedding) seeded with a stage, a traditional mandap and one flower arrangement, runs: (1) "What decorations can I add?" (2) "Change the flowers to white." (3) "Add a mandap and two floral arrangements." (4) "Check the decoration budget against ₹2 lakhs." (5) "Undo the previous decoration request.", and after each request checks the **real `WeddingState`**: tool selected, scene unchanged where it must be, only flower parts recoloured, +1 mandap and +2 arrangements, the reply's figure equals the code-computed estimate, and undo restores the exact scene from before request 3. It records model and provider, tool order, arguments and validation errors, scene after each step, latency, token usage and any API error to `apps/server/var/live-smoke-<time>.json`. Exit codes: `0` all passed, `1` a check failed, `2` not run (no key). A report only says `"live": true` when a real provider call was made; `--mock` runs are stamped `MOCK` in the output and the file name. Secrets are redacted from everything written.

### Inspection of the live path (code review, not a live finding)

- **Config:** `OPENAI_API_KEY`, `LLM_MODEL` (default `gpt-4.1-mini`), `LLM_REASONING_EFFORT` (sent only when set; reasoning models need `none` to call tools on chat completions). Provider abstraction unchanged: everything goes through `ChatCreate`.
- **Tool schemas:** zod to draft-7 JSON Schema (`z.toJSONSchema`, input side), passed as non-strict function tools. `z.partialRecord` becomes `propertyNames`/`additionalProperties`; non-strict mode should tolerate this, but it is untested against the real API and is the first thing to look at if a model ignores a tool.
- **Calls:** executed strictly in the order the model returns them, including several in one message; arguments that are not JSON become a recorded, recoverable failure (this used to be returned to the model but not shown to the customer; fixed). Up to 14 rounds.
- **History:** kept per workspace in memory, trimmed at user-message boundaries so no tool result is orphaned. Tool results are sent as full JSON (a scene listing can be large); no truncation yet.
- **Retries and timeouts:** the SDK is configured with a 30 s timeout and one retry per call; no retry of a whole request.
- **Error handling (changed):** a raw provider error can quote part of the API key ("Incorrect API key provided: sk-…"), and it used to be relayed to the browser. Provider failures are now mapped to a generic message by status (credentials, rate limit, provider trouble, timeout), and any key-shaped text is redacted before logging.

### Confirmation workflow (replaces the model-settable `confirmed` flag)

The model can no longer authorise its own high-impact actions. The `confirmed` and `customerAcceptedOverBudget` parameters were **removed from every tool schema**; an extra key the model sends anyway is stripped by validation and has no effect.

1. A tool that needs approval (raising a limit, or changing a total or an allocation, by more than 10%; adding or duplicating a decoration past the customer's own decoration limit) does **not** apply anything. It records a **proposal** and returns an error saying "Needs the customer's confirmation", with the exact change, and tells the model it cannot confirm, must not retry and must not claim it was applied.
2. `ProposalStore` (`apps/server/src/wedding/proposals.ts`) keeps it with an unguessable id (random UUID), the owning workspace, the exact validated reducer action (deep-frozen), an HMAC over id, workspace, action and a fingerprint, and the fingerprint of the part of the wedding it was written against.
3. The chat shows a card with the change and **Confirm** and **Cancel** buttons. Pending proposals are loaded from the server, so they survive a page reload.
4. Only `POST /api/wedding/:id/proposals/:pid/confirm` (and `/cancel`) act on it. These are browser routes outside the tool registry; no tool, chat text or model-supplied value reaches them, and a test asserts there is no tool whose name relates to confirming.
5. Confirming marks the proposal consumed **before** dispatching the action, so it can never apply twice, then dispatches it through the normal reducer (which can still refuse it, giving a 422).
6. It is rejected if it is: unknown or from another workspace (404, indistinguishable), already used (409), cancelled (409), expired after 10 minutes (410), altered (HMAC mismatch: discarded, 409), or stale because the budget or scene changed since it was written (discarded, 409).

Identical proposals (including a retried add with fresh generated ids) collapse into one; at most 10 can be pending per workspace. Ordinary decoration changes, first-time budget settings, changes under 10%, and lowering a limit need no confirmation.

**Tests added:** `proposals.test.ts` (forged flags and a model that tries repeatedly to confirm; replay; cancelled; workspace mismatch; expiry and the exact deadline; tampering; stale; the reducer rejecting an invalid proposal at confirm time; dedup and the cap; over-limit proposals applying the exact items and being undoable; the full HTTP round trip; provider-error leakage) and `api.test.ts` (3 tests). Existing tests that relied on the old flags were rewritten for the new workflow, not weakened. Totals: shared 171, web 96, server 346 = **613**, stable across two consecutive full runs.

**Browser (headless Chrome, real servers, no API key):** the original four-message acceptance passes; a new confirmation run passes 14 checks: first-time budget applies directly; a 100% change is only proposed; the card shows the exact change; typing "I confirm" or "yes, go ahead" in chat does not confirm; the proposal survives a reload; Cancel cancels and a later confirm gets 409 `cancelled`; Confirm applies it; replay gets 409; another workspace gets 404; an over-limit add is proposed, confirmed, applied exactly, and undone as one ordinary step. These browser scripts are not in the repo.

### Bugs found while hardening (all fixed)

- **Confirm, Cancel and "Reset to sample" never worked in a browser.** The client sent `content-type: application/json` on body-less POSTs and Fastify answers 400 (`FST_ERR_CTP_EMPTY_JSON_BODY`). "Reset to sample" has been broken since milestone 1; unit tests and curl never sent that header combination. Found by clicking Cancel in the browser run. Regression test added.
- **Wedding tests were writing to the real on-disk lead database** (`apps/server/var/leads.sqlite`) because `buildApp` did not forward the desk plugin's `dbPath`; with more test files this also caused intermittent `database is locked` failures. `buildApp` now forwards it and the wedding tests use `:memory:`.
- **Retried over-limit adds produced duplicate proposals**, because each retry generated fresh object ids.
- **"Newest first" ordering of pending proposals tied** when two were created in the same millisecond; it now uses a sequence number.
- **Provider error text could leak part of the key** to the browser (above).
- **A failed tool call with malformed JSON arguments was not shown in the chat.**

### Known limitations and remaining blockers

- **BLOCKER: no live-model evidence.** Whether a real model picks the right tools, honours the proposal protocol (reports it as pending rather than done), resolves "it", and copes with the non-strict schemas is **unknown**. The prompt and tool descriptions are untested against a real model. Nothing about latency, token cost or error rates has been measured.
- **Authentication is still capability-based.** There is no login: a workspace id held in the browser is the only credential, and it also authorises confirm and cancel. The proposal id is a second unguessable value, but anyone who can call the HTTP API for that workspace can confirm. What the design guarantees is that the **model and chat text cannot**. Real accounts are still to do.
- **Pending proposals live in server memory** and are lost on restart (they would read as "not found"). The wedding itself persists.
- **The planner's conversation history and undo context are also in memory.**
- **Hypotheses to check with a live model (not findings):** a model may call a tool when a proposal is pending instead of waiting; it may state a number from its own reasoning rather than a tool result (check 4 in the smoke test compares the reply to the code-computed figure); it may pick `mount: "stage"` for a second mandap on a stage too small for two (the tool reports the refusal and the harness checks the model recovers or reports it); very long scene listings may crowd the context.
- Not started, by instruction: vendor discovery or any other milestone 4 work.


## Milestone 4: curated vendor network and marketplace

**Data model** (`packages/shared/src/wedding/vendors/`): `Vendor` (id, business name, logo and portfolio, category, description, location + service areas, specialisations, guest capacity, services, starting price, packages with flat or per-guest pricing, availability, verification, review summary, source, timestamps). Nine categories (decorator, caterer, photographer, videographer, makeup, florist, planner, entertainer, venue). Honesty is enforced by the schema: demo data can never be `verified` and cannot carry reviews; `verified` needs `verifiedAt` and `verifiedBy`; availability is *unknown* unless someone supplied it (`checkAvailability`).

**Demo catalogue** (`demo-data.ts`): 13 fictional vendors, all `source: 'demo'`, names start with "Demo", shown as **DEMO DATA**, no contact details, no reviews, no availability, images are app-drawn gradient art. Base market Ramanagara/Bengaluru; locations and filters are derived from the data, so the model is location-independent.

**Server**: `vendor-store.ts` (JSON persistence in `apps/server/var/vendors/`, seeded on first run, re-validated on load), `vendor-routes.ts`. Customer routes: `GET /api/vendors` (filters: q, category, location, maxBudget, guests, style, verifiedOnly), `GET /api/vendors/:id`, shortlist (`POST/DELETE /api/wedding/:id/shortlist`; name/category/source come from the catalogue, `shortlist_vendor` is not a browser action), quote requests (`POST/GET /api/wedding/:id/enquiries`). Admin routes (`/api/admin/...`, header `x-admin-key` from `WEDDING_ADMIN_KEY`; outside production a visible demo key is used when unset, in production with no key admin is disabled): create/edit vendor, packages, service areas, portfolio, availability, verification, review and update quote requests. Verification needs a described method and refuses demo vendors.

**Quotations** are computed from list prices, labelled **SAMPLE QUOTATION**, deduplicated, and nothing is sent to any vendor (there is no vendor inbox yet).

**Vendor agent**: `specialists/vendor.ts` with `searchOurVendors`, `getVendorDetails`, `compareVendorPackages`, `shortlistVendor`, `removeShortlistedVendor`, `requestQuotation`, `getVendorAvailability`. Search defaults to the wedding's city and guest count; budget fit (customer limit, planned allocation remaining) is computed in code from the deterministic budget state. Empty results are reported as empty. Demo router handles "Find a traditional South Indian decorator in Ramanagara within ₹2 lakhs", "shortlist the first one", "compare them", "request a quote from ...".

**Web**: `/vendors` (search, category/location/budget/style/guest filters, trust badges, compare dialog, shortlist), `/vendors/:id` (packages with computed estimates, availability and trust panel, quote request), `/vendors/mine` (shortlist and enquiry tracking), `/vendors/admin` (admin UI).

**Tests**: `vendors.test.ts` (20): schema honesty, search maths, availability, all seven tools, the headline request end to end, routes, admin auth and verification rules.

## Milestone 6: Flagsmith, Sarvam, NudgeBee

**Flagsmith** (`apps/server/src/wedding/flags.ts`, package `@flagsmith/nodejs`): eight flags (`agent.decoration`, `agent.budget`, `agent.vendor`, `agent.fashion`, `studio.enabled`, `voice.sarvam`, `tryon.enabled`, `vendor.marketplace.enabled`). Evaluated server-side: a server key (`ser.…`) uses local evaluation (30 s refresh), any other key uses remote evaluation. A disabled specialist's tools are **not listed to the model**, and `runWeddingTool` re-checks the flag **before** running any tool (a test calls disabled tools by name). `vendor.marketplace.enabled` gates the marketplace API (403 `feature_disabled`); `voice.sarvam` gates the voice route; the browser hides pages from `GET /api/flags` (it can only read). Fallback: Flagsmith unreachable → last known values, with no history → defaults (all on), reported as `degraded`; flags missing in the Flagsmith project use the default and are shown as such. `/flags` in the app is a live view (refreshes every 5 s) to demonstrate toggling in the Flagsmith dashboard. **Verified with a mock provider only; no real Flagsmith call has been made** (no key available).

**Sarvam** (`sarvam.ts`, route `POST /api/wedding/:id/voice?lang=kn-IN|en-IN|unknown`): browser records audio (≤25 s; Sarvam REST limit is 30 s) → server posts it to `https://api.sarvam.ai/speech-to-text` (`api-subscription-key`, model `saaras:v4` by default per Sarvam's current docs, `language_code`) → transcript goes through `planner.chat`, i.e. the same tools, validators and reducer as typed chat. `SARVAM_API_KEY` is server-only; provider error bodies are never relayed. **Tested with a mocked HTTP response only; no real Sarvam call has been made.** Speech-to-text only: the reply is shown as text, there is no text-to-speech.

**NudgeBee**: not integrated, deliberately. See [docs/NUDGEBEE.md](NUDGEBEE.md): it is an SRE/CloudOps platform; no wedding-relevant API and no hackathon brief were found. Options and the information needed are listed there.

## Workspace ownership and persistence (Milestone 7.5)
- **Demo session ownership** (`owners.ts`): the browser claims its workspace (`POST /api/wedding/:id/claim`) and gets a secret token (only a SHA-256 hash is stored). Once claimed, every `/api/wedding/:id/...` request (chat, voice, actions, shortlist, enquiries, confirm/cancel) needs `x-workspace-token`; the id alone no longer works. An unclaimed workspace is open. This is not login: the token is in `localStorage`. The path to real auth is replacing `OwnerStore.verify` in the single hook in `routes.ts`.
- **Pending proposals** now persist (`var/proposals/`), with the HMAC key persisted too; a tampered file fails the integrity check. **Planner conversation history** persists per wedding (`var/planner/`). The "undo that" request context is still in memory.


## AI aspiration-based design (milestone: photos to a complete 3D wedding)
Contract and routes: [AI_DESIGN_CONTRACT.md](AI_DESIGN_CONTRACT.md). Deployment: [../DEPLOYMENT.md](../DEPLOYMENT.md). Assets: `apps/web/src/wedding/studio/ASSETS.md`.

**Flow.** `/studio` is now "Create your dream wedding": pick a sample venue, upload up to 6 photos (JPEG/PNG/WebP, 6 MB each), describe, choose style, guests, decoration budget and palette, press Generate. A job runs `pending → analysing → planning → rendering → completed | failed | cancelled`; the scene changes only in one final atomic `apply_design_plan` (a single undo step), so the previous design stays on any failure. The result page shows the rendered 3D scene, summary, palette, decoration summary, sample-price cost, substitutions ("what I could not reproduce"), versions (save, another version, compare, restore, delete) and the planner chat for refinement. The old editor is `/studio/edit` ("Advanced Edit").

**Real vs demo.**
- *Real path* (needs `OPENAI_API_KEY` **and** `WEDDING_VISION_MODEL`, and S3 or local photo storage): photos are sent server-side at low detail with a strict JSON schema; the reply is zod-validated into a `WeddingDesignBrief` (one repair retry; refusal, timeout, 401/429/quota/5xx mapped to safe messages). Version `source` is `vision`. **Never run against a real model here: image support, strict-schema acceptance and output quality are unverified.** `pnpm --filter @ave/server wedding:design-smoke` makes one real call (exit 2 when not configured).
- *Demo path* (no vision model): the brief is built from the form text only; the UI and the design say "Sample design: your photographs were NOT analysed"; photos are not even uploaded. Version `source` is `demo`.
- `gpt-4.1-mini` is deprecated by OpenAI (retirement 2027-01-14, replacement listed as `gpt-6-luna`; its capabilities were not confirmed). There is deliberately no default vision model.

**Planner (shared, deterministic).** `design/zones.ts` derives stage, mandap, entrance, aisle, seating, ceiling and side-wall zones from each room's real geometry; `design/plan.ts` picks catalogue pieces from the brief, colours parts from the palette, sizes quantities from guests and grandness, places everything with the studio's own placement/collision code, trims to the budget with `suggestTrim`, and records substitutions. The model never produces coordinates or code. `refineBrief` maps chat requests (colour, grander/simpler, jasmine/marigold, traditional/modern, lighting, cheaper) onto the stored brief, then re-plans; "another version" changes the layout variant and keeps old versions.

**Storage.** `storage/`: private local directory or S3-compatible bucket; MIME by magic bytes, size/count caps, random ids, no client filenames, owner-only access under the workspace token, deletion, retention sweeper. No blobs in `WeddingState` (only ids). Images are passed to the model without downscaling (no `sharp`); 6 MB cap.

**Assets.** Procedural models upgraded (mandap, stage, flower wall, arch, garland curtain, arrangement, chair, chandelier); a GLB loader with procedural fallback and a licence registry exist, **but no GLB was added** because no model's licence and download were verified. Everything is still low-poly and untextured.

**Limits.** Jobs do not queue behind chat turns (a design finishing during a chat edit can overwrite it; undo restores). "Prefer image N" is not applied in chat (needs a new image analysis). Nothing here was opened in a browser by me; the web flow was typechecked, unit-tested and built only.

# Wedding OS: handoff for a new chat

Read this file first. It is written so a new session does not need to re-explore the repo. Deeper detail is in `docs/WEDDING_OS.md`; the original reuse audit is `/Users/krrishagrawal/automation/TEMP2/REUSE_AND_INTEGRATION_REPORT.md`.

## 1. What this is

**Wedding OS**: an AI wedding-planning app (3D venue studio, budget planner, AI planner whose tools really change the shared state). It is the **Agora Virtual Estates** repo transformed in place, for a hackathon.

- Repo: `/Users/krrishagrawal/automation/TEMP2/agora-virtual-estates`
- Branch: `feat/wedding-os` (from `main` @ `518a94c`). **Work is committed on this branch and pushed to the `wedding-os` repo.
- Reference clones (read-only sources, in `/Users/krrishagrawal/automation/TEMP2/`): `room-configurator` (ported for scene geometry), `try-on` (MIT, for Milestone 4), `fashn-vton-1.5` (later optional GPU service), `StyleSense`, `cloak`, `Leffa`, `Spatial-AR-Furniture-Configurator`, `wedding_planner_multiagenticAI`. "Altara" was never present. The user said reuse permissions are already handled: do not keep asking.
- Final app must be self-contained: no imports from sibling repos, no submodules.

## 2. How to run (machine gotchas)

```bash
cd /Users/krrishagrawal/automation/TEMP2/agora-virtual-estates
export PATH="$HOME/.nvm/versions/node/v22.22.2/bin:$PATH"   # Node 22 only exists in nvm; default node is old
pnpm install --frozen-lockfile       # pnpm 12.18.0 via corepack, TypeScript 7, Vite 8, Vitest 5
pnpm typecheck && pnpm test && pnpm build
pnpm dev                              # web http://localhost:5173, API http://127.0.0.1:8787
```

- Works with **no API keys** (demo mode). Voice features need Agora/OpenAI/Murf; not used by Wedding OS.
- zsh/macOS: `sed -i ''` needs the empty string; quote `--include='*.py'` globs; `timeout` doesn't exist; foreground `sleep` is blocked by the harness.
- Runtime data lives in gitignored `apps/server/var/` (`weddings/<id>.json`, `leads.sqlite`). Delete `var/weddings/*.json` after manual runs.
- User's other project `~/automation/shaadios/` is unrelated; never read its `.env`.

## 3. Status (updated)

Branch `feat/wedding-os`, pushed to the `wedding-os` GitHub repo. Milestones done: 0-3 (state, reducer, studio, planner), 3-hardening (proposals), 4 (vendor marketplace, DEMO DATA), 5 (try-on engine, in-browser), 6 (Flagsmith, Sarvam STT; NudgeBee NOT done), 7 (onboarding, dashboard, ownership, persistence), AI aspiration-based design (photos to brief to deterministic scene, versions, jobs, storage abstraction), deployment prep (Render, `DEPLOYMENT.md`), realism pass (CC0 Poly Haven GLBs/textures/HDRIs, `fetch-polyhaven.mjs`).

Tests at last check: shared 200, web 132, server 435; typecheck clean. Realism visuals NOT verified in a browser; no screenshots exist yet. See `AGENTS.md` "Open work" for the priority list. Sections 4-10 below were written at milestone 3 and are still accurate for the core architecture, but the "Known limitations" and "Next steps" there are partly superseded by `AGENTS.md`.

## 4. Architecture map

### `packages/shared/src/wedding/` (pure TS, zod, no React)
- `state.ts`: `WeddingState` (profile, venueId, `scene.objects`, `sceneHistory` {past,future}, `designs`, `budget` {total, allocations, expenses, **limits**}, vendorShortlist, outfits). Money = whole rupees. Older saved files still load (new fields have defaults).
- `actions.ts`: `WeddingActionSchema` + `applyWeddingAction(state, action)` is the **only** way state changes; returns `{ok,state}` or `{ok:false,error,hint,code?}`. `CLIENT_ALLOWED_ACTIONS` = what the browser may post (not `reset_to_sample`).
- `budget.ts`: `suggestAllocation` (sums exactly), `summarizeBudget`, `formatInr` (Indian grouping).
- `sample.ts`: sample venues/vendors (everything labelled sample), `createSampleWedding`.
- `scene/`: `geometry.ts` (polygon rooms, SAT overlap; **radians, Three.js `rotation.y` convention**), `placement.ts` (add/move/rotate/scale/duplicate/remove/recolour, grid 10 cm, wall snap 15 cm, free-spot search, batch ops), `catalog.ts` (11 items, `samplePrice`, `PRICE_NOTE`), `rooms.ts` (2 sample rooms; default ballroom), `actions.ts` (13+ scene actions, history cap 30, designs cap 20, **decoration limit enforced here**), `cost.ts` (`sceneCost`, `suggestTrim`), `colors.ts` (named colours), `serialize.ts` (versioned scene file).
- Mounts: **floor, stage** (on top of a stage object; stage carries children, can't be removed/rotated/scaled while it holds objects), **wall** (flush, faces in, can't rotate), **ceiling** (hangs). Collisions only within the same mount and overlapping height.
- Batch actions are single undo steps: `add_decors`, `remove_decors`, `set_decor_colors`. Others: `set_budget_limit`, `undo_scene`, `redo_scene`, `save_design`, `load_design`, ...
- **Name clash note:** legacy exports `Room`/`RoomSchema` exist; wedding uses `StudioRoom`.

### `apps/server/src/wedding/`
- `store.ts`: in-memory workspaces persisted as JSON; ids `[A-Za-z0-9_-]{1,64}`; invalid files quarantined.
- `toolkit.ts`: `defineTool`, `ToolContext {store, proposals, weddingId, session}`, `propose()`, `PlannerSession` (selectedId, lastTouched, requestSteps, lastRequest).
- `specialists/`: `decoration.ts` (12 tools), `budget.ts` (7), `venue.ts` (4). These are function-call modules, **not autonomous agents**.
- Tools: `listDecorationAssets listSceneDecorations addDecoration moveDecoration rotateDecoration scaleDecoration changeDecorationMaterial duplicateDecoration removeDecoration undoDecorationAction saveWeddingDesign loadWeddingDesign | getBudgetSummary setTotalBudget allocateBudget setBudgetLimit estimateDecorationCost addExpense checkBudgetFeasibility | getWeddingOverview updateWeddingProfile listVenues selectVenue`.
- `orchestrator.ts`: dispatcher with memory; validates, runs tools, tracks touched objects and scene steps per request (for "undo that").
- `planner.ts`: two paths, **one executor**. Live: `runToolLoop` (from `agent/sim.ts`) with all tool schemas, up to 14 rounds, provider behind `ChatCreate`. Demo: `demo.ts` rule router (compound requests, pronoun/selection resolution, honest "not supported"). Emits `tool_start`/`tool_end`/`done` events. `providerError()`/`redactSecrets()` sanitise provider errors.
- `proposals.ts`: pending customer confirmations (see section 5).
- `routes.ts`: `GET /api/wedding-meta`, `GET/POST /api/wedding/:id`, `/actions`, `/reset`, `/chat` (JSON, or `stream:true` NDJSON; accepts `selectedId`), `/proposals`, `/proposals/:pid/confirm|cancel`.
- `scripts/live-smoke.ts`: live-model smoke harness (`pnpm --filter @ave/server wedding:smoke`, `--mock` for harness-only).
- `app.ts` `buildApp(ctx, {logger, wedding, desk})`: **tests must pass `desk: { dbPath: ':memory:' }`** or they touch the real lead DB.

### `apps/web/src/wedding/`
`WeddingShell` (nav), `Dashboard`, `Planner` + `ChatPanel` (shared; streaming steps, proposal cards), `Budget` (limit card), `studio/` (`StudioPage`, `StudioScene` drag-to-move, `models.tsx` procedural models, `VenueModel` cutaway walls, `useStudio` selection/drag), `useWedding` (zustand: state, messages, proposals; ignores stale revisions), `api.ts` (**no JSON content-type on body-less POSTs**). Routes in `App.tsx`; legacy real-estate screens kept under `/legacy`, `/call/*`, `/desk/*`. Studio is lazy-loaded. Theme: `--color-blue*` tokens re-valued to rose; BRAND_NAME "Wedding OS".

## 5. Key design rules (do not break)

1. **All state changes go through `applyWeddingAction`.** The LLM never touches Three.js or state directly. Scene is a pure projection of state.
2. **Deterministic money:** the model never does arithmetic; budget tools call shared code. Every price is **sample** data, labelled.
3. **The model cannot authorise itself.** Tools like `setTotalBudget` (>10% change), `allocateBudget`, `setBudgetLimit` (raise >10%), and over-limit `addDecoration`/`duplicateDecoration` return a **proposal** (`ok:false` + `proposal`), changing nothing. Only the browser routes `/proposals/:pid/confirm|cancel` apply it. Single use, 10-minute expiry, workspace-bound, HMAC integrity, state-fingerprint staleness, dedup, max 10 pending. Chat text like "I confirm" never confirms. No tool relates to confirming (a test asserts it).
4. The customer's decoration limit is enforced **in the reducer**; only a confirmed proposal sets `acceptOverBudget`.
5. "Undo that" = `undoDecorationAction({lastRequest:true})`: undoes the whole previous request only if the scene is exactly as that request left it; otherwise one step, with a note.
6. Never claim success the backend didn't confirm. Demo mode says "not supported" instead of pretending.
7. Keep API keys server-side only; redact key-shaped text in logs/errors.

## 6. Verification approach (and lessons)

- Unit/integration: vitest in all three workspaces. Server wedding tests: `store`, HTTP routes, planner (demo + mocked live), `proposals.test.ts`.
- **Browser acceptance** is how real bugs were found (typecheck/tests/build missed them). Recipe (scripts live in an ephemeral scratchpad, so recreate): `npm i puppeteer-core` in a scratch dir outside the repo; launch `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` with `headless:'new'` and args `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --no-sandbox`; run `pnpm dev`; drive the UI, read state via `fetch('/api/wedding/<localStorage "wedding-os:id">')`, screenshot to view.
- Bugs only a browser/e2e run caught (all fixed): M1 Planner page crashed (`useEffect` returning `scrollIntoView`'s Promise: use a block body); Confirm/Cancel/"Reset to sample" dead (JSON content-type on body-less POST → Fastify 400); camera sat outside the near wall; rotation rounding broke wall-flush pieces; flower colour invisible under canopy; tests polluting real lead DB.
- Acceptance conversations that pass in demo mode: (1) "Create a traditional South Indian wedding with a gold mandap and yellow flowers" → (2) "Change the flowers to white and add more arrangements" → (3) "Keep the decoration budget below ₹2 lakhs" (trims, explains, offers undo) → (4) "Undo the last change". Plus the 14-check confirmation flow.

## 7. What was and was NOT tested live

- **Real-model (OpenAI) tool calling: NEVER RUN.** No `OPENAI_API_KEY` on this machine; do not borrow keys from other projects. All live-path tests use scripted mock providers and prove loop mechanics only, not model behaviour. Never describe a mock run as live.
- To run it: `export OPENAI_API_KEY=...` then `pnpm --filter @ave/server wedding:smoke` (exit 0 pass, 1 fail, 2 not run). Seeds a sample workspace, runs 5 requests (list assets; flowers white; add mandap + 2 arrangements; check ₹2 lakh decoration budget; undo), checks real `WeddingState` after each, writes `apps/server/var/live-smoke-<time>.json`. First things to inspect if it fails: the non-strict tool schemas (`propertyNames` from `z.partialRecord`), whether the model reports proposals as pending, and numbers quoted without a tool.

## 8. Known limitations

- No login: workspace id in the browser is the only credential (also authorises confirm/cancel).
- Pending proposals, planner history and undo context are in server memory (lost on restart); the wedding persists.
- Demo mode is a phrase router (see `DEMO_HELP`); "warm lighting" = warm-coloured chandeliers/lanterns (no global lighting control).
- Models are simple procedural shapes (no licensed GLB assets yet); cutaway walls make near-wall decorations look floating until you orbit; rotate/scale are button-only; only two sample venues have 3D rooms; redo is not a chat tool; design export/import has no UI.
- Legacy real-estate code still in tree and tested; UI not checked on phones/Safari/Firefox.

## 9. Next steps (in order)

1. **Run the live smoke test** with a real key and fix whatever it reveals (this is the main open risk).
2. Commit the work on `feat/wedding-os` (ask the user first).
3. **Milestone 4** (only when the user asks): vendor discovery as a fourth specialist module on the same toolkit with clearly labelled **sample** vendors (`SAMPLE_VENDORS` exists); virtual outfit try-on from `/Users/krrishagrawal/automation/TEMP2/try-on` (`packages/tryon-core`, `thin-plate-spline`, `litert-react`, catalogue schema `src/garments/`; **do not copy model weights or garment images without checking licences**; try-on is browser-only 2D warp, 2 lehenga-choli garments, no saree/sherwani); FASHN stays a later optional GPU service (Apache-2.0 but `fashn-human-parser` licence unclear).
4. Sponsor integrations: **Flagsmith** (server-side flags gating specialists/tools), **Sarvam AI** voice (behind an interface; agora's old STT option is the only hint), **NudgeBee** (its role is still undefined; ask the user before building).
5. Real authentication; durable proposal/history storage.

## 10. User preferences observed

- Wants honest reporting: say precisely what was tested live vs mock; list files changed, tests, blockers.
- Prefers small, tested increments; do not start the next milestone unprompted.
- Wants reuse of existing infrastructure (tool runner, provider abstraction, reducer); no new agent framework.
- Wants new chats to be cheap: keep this file current when milestones change.

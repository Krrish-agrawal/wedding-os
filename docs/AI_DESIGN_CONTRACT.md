# AI design: contract between shared, server and web

Already built (shared, tested): `packages/shared/src/wedding/design/` — `WeddingDesignBriefSchema`, `DesignFormSchema`, `zonesFor`, `planScene` (deterministic; returns validated `DecorObject[]`, cost, palette, substitutions, notes, description), `refineBrief`, `demoBriefFromForm` + `DEMO_DESIGN_NOTICE`, and reducer actions in `design/apply.ts`: `apply_design_plan` (server-only), `restore_design_version`, `delete_design_version`, `snapshot_design_version` (browser-allowed), `set_reference_images` (server-only). State: `WeddingState.design` = `{ form, brief, source: 'vision'|'demo'|null, referenceImageIds, versions[] (max 10), activeVersionId, variantCounter }`. A version's `source` is `vision` | `demo` | `manual`.

Honesty rules (tests must enforce): never say photographs were analysed unless the job's `source === 'vision'` and a real vision call was made; never say a real venue was reconstructed; demo mode must say "Sample design... photographs were NOT analysed"; no image blobs in state; no keys or image bytes in logs.

## Routes (all under the existing workspace-ownership hook: `x-workspace-token`)
- `GET  /api/wedding/:id/design/status` → `{ visionConfigured: boolean, visionModel: string|null, storage: 'local'|'s3', limits: {maxFiles,maxBytesPerFile,retentionHours}, flagEnabled: boolean }` (no model call).
- `POST /api/wedding/:id/images` multipart, field `file` (one image per request) → `201 { image: { id, mime, bytes, createdAt, expiresAt } }` or `{ error, code }` with 413/415/400/409/429. Count/size/type enforced server-side by magic bytes.
- `GET  /api/wedding/:id/images` → `{ images: [{id,mime,bytes,createdAt,expiresAt}] }`; `GET /api/wedding/:id/images/:imageId` → image bytes with `cache-control: private, no-store` (owner only); `DELETE /api/wedding/:id/images/:imageId` → `{ ok: true }` and updates `design.referenceImageIds` via `set_reference_images`.
- `POST /api/wedding/:id/design/generate` body `{ form: DesignForm, venueId?: string, imageIds: string[] }` → `202 { job }`. Sets the venue (if given and fits), the decoration limit from `form.decorationBudgetInr`, and the guest count, through reducer actions. One active job per workspace (409 otherwise).
- `GET  /api/wedding/:id/design/jobs/:jobId` → `{ job }`; `POST .../jobs/:jobId/cancel` → `{ job }`.
  `job = { id, status: 'pending'|'analysing'|'planning'|'rendering'|'completed'|'failed'|'cancelled', progress: 0..1, source: 'vision'|'demo', error: { code, message } | null, versionId: string|null, startedAt, finishedAt|null, latencyMs|null, usage: { model, promptTokens, completionTokens }|null }`. Error codes: `no_vision_key`(never an error in demo), `rate_limited`, `quota`, `timeout`, `provider_down`, `refused`, `invalid_output`, `plan_failed`, `cancelled`. The scene changes ONLY at the final `apply_design_plan`; before that the previous scene stays.
- `POST /api/wedding/:id/design/another` → `202 { job }` (same brief, `variantCounter+1`, new version; existing versions kept).
- State changes the browser does itself go through the normal `/actions` route (`restore_design_version`, `delete_design_version`, `snapshot_design_version`).

## Planner tools (new specialist `design`, flag `agent.decoration` + new flag `studio.ai_design`)
`refineDesign({instruction})`, `generateAnotherVersion()`, `restoreDesignVersion({versionId})`, `compareDesignVersions({versionIdA, versionIdB})` (computed differences: cost, piece counts by category, palette), `listDesignVersions()`. Refinement = `refineBrief` → `planScene` → `apply_design_plan` as a new version (the old versions stay). "prefer the Nth image" needs a real vision call (live only); in demo it says so. Over-limit results use the existing proposal flow.

## Web
- `/studio` = new `DesignStart` (create-your-dream-wedding form) → `GenerationProgress` → `DesignResult` (rendered 3D scene, description, palette, decoration summary, estimated cost with sample-price label, substitutions, versions: save/another/compare/restore, chat panel, "Advanced Edit"). The existing `StudioPage` moves to `/studio/edit`.
- Default experience shows no 3D editing controls.

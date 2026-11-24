# AGENTS.md: guide for AI agents working on Wedding OS

Read this, then `HANDOFF.md` (architecture and status), then the doc for the area you touch (`docs/WEDDING_OS.md`).

## Setup and checks
- Node 22 (nvm), pnpm 12 via corepack, TypeScript 7. `pnpm install && pnpm typecheck && pnpm test && pnpm build`.
- Monorepo: `packages/shared` (pure TS + zod, domain logic), `apps/server` (Fastify), `apps/web` (Vite, React 19, R3F, zustand).
- Wedding code: `packages/shared/src/wedding/`, `apps/server/src/wedding/`, `apps/web/src/wedding/`. Legacy real-estate code stays and is still tested.
- Server tests must pass `desk: { dbPath: ':memory:' }` to `buildApp`.
- Runtime data is gitignored JSON under `apps/server/var/` (`WEDDING_VAR_DIR` overrides). Not durable on Render's free tier.
- Last recorded test counts: shared 200, web 132, server 435. Typecheck clean.

## Non-negotiable rules
1. **State changes only through `applyWeddingAction`** (shared reducer). The LLM never touches state or Three.js directly.
2. **Money is deterministic.** Models never do arithmetic; prices are sample data and labelled.
3. **The model cannot authorise itself.** Over-budget or large changes return a *proposal*; only the browser confirm route applies it.
4. **Honest labelling.** Vendor data is DEMO DATA; demo data can never be "verified" (admin only, with a method); quotes are SAMPLE QUOTATION; availability is unknown unless supplied; demo design says "photos NOT analysed".
5. **Never describe mock tests as live.** Say what was run against a real service and what was mocked.
6. **Demo mode must keep working with no keys.** Flags fall back safely (all on).
7. **Sponsor integrations are genuine or absent.** Do not fake NudgeBee, Flagsmith, or Sarvam behaviour.
8. Secrets stay server-side, never logged or committed. Do not commit `.env`.
9. Assets need a verified licence recorded in `apps/web/src/wedding/studio/assets/registry.json` / `ASSETS.md`. No image blobs in `WeddingState`.
10. Keep `HANDOFF.md` current when status changes.

## Where things are
- Reducer/actions: `packages/shared/src/wedding/{state,actions}.ts`; scene: `.../scene/`; AI design planner: `.../design/`; vendors: `.../vendors/`.
- Planner/tools: `apps/server/src/wedding/{planner,orchestrator,toolkit,routes}.ts`, `specialists/`; vision + jobs: `.../design/`; storage: `.../storage/`.
- UI: `apps/web/src/wedding/` (`studio/`, `studio/design/`, `vendors/`, `tryon/`).

## Open work (priority order)
1. Verify 3D venue realism in a browser (screenshots of ballroom, courtyard, lawn; check GLB loading, textures, HDRI, fps, elephant orientation; a `409` on page load is untraced).
2. Real-key checks: vision model (`WEDDING_VISION_MODEL`, no default; `gpt-4.1-mini` is deprecated), `pnpm --filter @ave/server wedding:smoke`, design smoke script, Flagsmith, Sarvam, S3.
3. Durable storage (database) instead of JSON files.
4. NudgeBee integration (needs the hackathon brief: `docs/NUDGEBEE.md`).
5. Full Playwright E2E suite and `docs/FINAL_E2E_REPORT.md` (deliberately not started until the site is complete).
6. Try-on on a real photo; image downscaling (`sharp`) before the vision call.

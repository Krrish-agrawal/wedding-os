# Wedding OS

An AI wedding-planning app: upload inspiration photos, get a 3D wedding venue design, refine it by chat, plan the budget, browse vendors, try on outfits. Built for a hackathon on top of the Agora Virtual Estates codebase (the real-estate app is kept under `/legacy`, `/call/*`, `/desk/*`).

**AI agents and new contributors: read [`AGENTS.md`](AGENTS.md) first, then [`HANDOFF.md`](HANDOFF.md).**

## Features
- **3D Wedding Studio** (React Three Fiber): sample venues, decoration catalogue, place/move/rotate/recolour/undo, saved designs.
- **AI design from photos**: up to 6 inspiration images become a validated `WeddingDesignBrief`, a deterministic planner builds the scene. Chat refinement, design versions, Advanced Edit. Works in a labelled demo mode without keys.
- **Planner chat**: tools change the shared state through one validated reducer; budget maths is deterministic; money changes need customer confirmation.
- **Vendor marketplace**: curated, clearly labelled DEMO DATA, admin verification, SAMPLE QUOTATION.
- **Virtual try-on**: in-browser (MIT-licensed engine, see `apps/web/src/tryon/engine/NOTICE`).
- **Integrations**: Flagsmith feature flags, Sarvam speech-to-text. NudgeBee is not integrated (needs the hackathon brief).

## Run locally
```bash
# Node 22 required (nvm). pnpm via corepack.
pnpm install
cp .env.example .env     # every key is optional; the app runs in demo mode without them
pnpm dev                 # web http://localhost:5173, API http://127.0.0.1:8787
pnpm typecheck && pnpm test && pnpm build
```
Optional: `pnpm --filter @ave/web tryon:setup` fetches try-on runtime files; `node apps/web/scripts/fetch-polyhaven.mjs` re-fetches the CC0 3D assets.

## Docs
| File | What |
|---|---|
| `AGENTS.md` | Rules and map for AI agents |
| `HANDOFF.md` | Status, architecture, design rules, known gaps |
| `docs/WEDDING_OS.md` | Per-milestone detail |
| `docs/AI_DESIGN_CONTRACT.md` | Photo-to-design contract |
| `docs/NUDGEBEE.md` | Sponsor integration notes |
| `DEPLOYMENT.md` | Render + static web deployment |
| `apps/web/src/wedding/studio/ASSETS.md` | 3D asset licences |
| `docs/AGORA_ORIGIN_README.md` | Original real-estate app README |

## Honesty status
Real vision model, S3, Flagsmith and Sarvam were only tested against mocks. Try-on was not run on a real photo. The 3D "realism pass" (Poly Haven models, HDRI lighting) is implemented but its visuals were **not verified in a browser**. Details in `HANDOFF.md`.

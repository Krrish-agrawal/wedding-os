# Third-party code in `apps/web/src/tryon/engine/`

Vendored (copied, not imported) from **pravoobi/try-on** at commit `b14a999`, licensed **MIT** (see `engine/LICENSE-try-on-MIT`).
Copyright (c) 2026 Praveen (pravoobi).

| Here | From |
|---|---|
| `engine/{types,depthTypes,mattingTypes,config,anchorMapping,compositor,garmentExtract,gesture,harmonize,letterbox,maskRender,normalMap,orientation,pose,preprocess,relight,segmenter}.ts`, `engine/inference.worker.ts` | `packages/tryon-core/src/` (`@practics/tryon-core` 0.2.0) |
| `engine/tps/index.ts` | `packages/thin-plate-spline/src/index.ts` |
| `engine/litert-worker.ts` | `packages/litert-react/src/worker.ts` |
| `../../scripts/tryon-setup.mjs` | `tools/fetch-models.mjs`, `tools/copy-litert-wasm.mjs` |

Changes: imports rewritten to local paths; `// @ts-nocheck` added to each file (they were written without this repo's strict index checks); tests, the matting/depth workers and the garment-extraction model code were not copied. No model weights and no garment images were copied.

## Not committed, fetched at setup (`pnpm --filter @ave/web tryon:setup`)
- LiteRT.js Wasm runtime, copied from `node_modules/@litertjs/core` (Apache-2.0).
- `selfie_segmenter.tflite` (~250 KB, Google MediaPipe) and `movenet_singlepose_lightning.tflite` (~4.7 MB, Google MoveNet). Both are Google models; their model cards say Apache-2.0. Check before commercial use.

## Garment artwork
All garment pictures are original procedural drawings made by `garmentArt.ts`. They are illustrations, not product photos.

## Not used
FASHN VTON 1.5 (GPU diffusion service) was not integrated: its `fashn-human-parser` licence is unresolved and it needs a GPU host.

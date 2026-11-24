# Deploying Wedding OS

Architecture: a **static web app** (Vite build) and one **Fastify Node service** (API). The wedding pages talk to the API
over plain HTTP (`/api/...`, including a streamed NDJSON chat). They use **no WebSocket**; only the legacy real-estate
call and desk screens do (`VITE_WS_ORIGIN`, with automatic reconnection already built in). The older, longer walk-through
in [docs/deploy.md](docs/deploy.md) still applies to those legacy parts.

## What is persistent and what is not
| Data | Where | Survives a restart on Render free? |
|---|---|---|
| Weddings, vendors, enquiries, workspace owners, proposals, planner history, design jobs | JSON files under `WEDDING_VAR_DIR` (default `apps/server/var`) | **No** (ephemeral disk) |
| Lead desk SQLite (legacy) | same directory | **No** |
| Inspiration photos | `STORAGE_DRIVER=s3` bucket (private) | **Yes**, if you configure S3 |

For anything beyond a demo, either use a paid Render plan with a **persistent disk** mounted at the path in
`WEDDING_VAR_DIR` (see the commented `disk` block in `render.yaml`; single instance only), or move customer data to a
database. A database layer is **not built yet**: it is the main blocker for real customer data.

## Backend (Render web service)
`render.yaml` defines `wedding-os-api`: build `corepack enable && pnpm install --frozen-lockfile --prod=false`, start
`pnpm --filter @ave/server start`, health check `/api/health`. The server binds `0.0.0.0` and the port Render injects
(`PORT`; `SERVER_PORT` is only a fallback). Set secrets in the Render dashboard, never in files:

| Variable | Needed for |
|---|---|
| `WEB_ORIGIN` | the web app's public URL (CORS + links). `CORS_ORIGINS` adds more, comma separated |
| `WEDDING_ADMIN_KEY` | vendor admin page (admin is disabled in production without it) |
| `OPENAI_API_KEY`, `LLM_MODEL` | the AI planner (otherwise demo mode) |
| `WEDDING_VISION_MODEL` | AI design from photos. No default: choose a model you have verified for image input + structured output |
| `FLAGSMITH_ENVIRONMENT_KEY` | feature flags (`ser.` key = local evaluation) |
| `SARVAM_API_KEY` | voice input |
| `STORAGE_DRIVER=s3` + `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_REGION`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY` | private photo storage |
| `IMAGE_RETENTION_HOURS` | how long photos are kept (default 24) |
| `WEDDING_VAR_DIR` | runtime data directory (persistent disk mount) |

CORS allows only `WEB_ORIGIN` plus `CORS_ORIGINS`, with methods GET/HEAD/POST/PUT/PATCH/DELETE and the headers
`content-type`, `x-workspace-token`, `x-admin-key`.

## Frontend
Build: `pnpm --filter @ave/web build` (output `apps/web/dist`).
- **Vercel** (`vercel.json`): SPA fallback plus an `/api/*` rewrite to `https://wedding-os-api.onrender.com`. No API URL variable needed. Change the rewrite target if your Render service has another address. Vercel buffers rewrites, so check that the streamed chat still shows steps live; if it does not, use the direct mode below.
- **Direct mode / Render static site** (`wedding-os-web` in `render.yaml`): set `VITE_API_BASE_URL` to the API's address at build time and make sure the API's `WEB_ORIGIN`/`CORS_ORIGINS` include the site. All wedding API calls then go straight to the API.
- Try-on needs the LiteRT Wasm runtime and two small model files: run `pnpm --filter @ave/web tryon:setup` before `build` (they are gitignored, so add it to the build command if you want try-on in production).

## Checklist before a public demo
1. Health: `curl https://<api>/api/health` returns `{"ok":true,...}`; the free plan sleeps after 15 minutes, so wake it first.
2. Open the site; `/flags` should say where flags come from; `/vendors` loads; the planner answers.
3. Photos: with S3 configured, upload one in `/studio`, confirm it deletes on request, and that the bucket is **private**.
4. Set `WEDDING_ADMIN_KEY`; confirm `/api/admin/vendors` answers 401 without it.
5. No real key is committed (`git grep -n "sk-" -- . ':!*.test.ts'`).

## Known gaps
No database (see above); no login (a browser-held workspace token, see docs/WEDDING_OS.md); Flagsmith, Sarvam, the vision model and the S3 adapter have not been exercised against the real services in development; one API instance only (in-memory queues and files).

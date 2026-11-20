# Working conventions for every agent

Read `docs/BUILD_PLAN.md` first. This file is the house rules for building it in parallel.

## Environment (strict)

- Work only inside `/Users/shivammahendru/test/agora-virtual-estates`. Never write outside it, except the scratchpad your session gives you.
- **Do not install anything.** No `pnpm add`, `npm install`, `npx <tool>` that downloads, `curl | sh`, global tools, browser binaries or system changes. All dependencies are already installed. If you truly need a package, stop and say so in your final report with the package name and why.
- **Do not download files** (models, images, fonts, binaries). Reading web pages and API documentation is fine. Calling free public data APIs (OpenStreetMap Overpass, Nominatim, OSRM) from a script is fine when your brief says so; respect their usage policies (a descriptive User-Agent without personal data, low request rates, cache results to files).
- Never put secrets in the repo or in client code. Read them from `process.env` on the server only. `.env` is git-ignored; `.env.example` documents variables.
- No git: this project is intentionally not a git repository. Never run `git init`, commit, push, or create a repository.
- Dev servers already run: web at http://localhost:5173 (Vite, hot reload) and API at http://127.0.0.1:8787 (tsx watch, restarts on server file changes; in-memory sessions reset on restart). Do not start other servers on those ports.
- If you use the built-in browser to check your work, open your own tab (`tabs_create`), emulate a 1440x900 viewport (`resize_window`), and never touch other tabs. `/studio` has a Director that creates a test session and drives any view (number keys 1–9 switch views, 0 switches property).

## Code ownership

Each agent owns specific paths (given in its brief). Edit only those. Exceptions:

- `packages/shared/` holds the contracts. You may make **additive, backward-compatible** changes there (new files, new exports, new optional fields). Do not rename, remove, or change the meaning of anything existing. Re-read a shared file right before editing it; other agents edit it too. List every shared change in your final report.
- `apps/web/src/views/registry.ts`, `apps/web/src/App.tsx`, `apps/server/src/app.ts`, root and workspace `package.json` files are owned by the lead. Ask in your final report if you need a change.

## Contracts to build against

- `packages/shared/src/session.ts` — `SessionState`, `SessionAction`, the WebSocket protocol.
- `packages/shared/src/reducer.ts` — the only way state changes. Server: `app.ctx.store.dispatch(sessionId, action, source)`.
- `packages/shared/src/views.ts` — view ids and per-view params.
- `packages/shared/src/data.ts` + `content.ts` — content schemas and the loader. Content is read from `/data` (server: `app.ctx.content`; web: `import { content, getBundle } from '@/content'`).
- `packages/shared/src/tools.ts` — tool names, input schemas, descriptions, result shape.
- `packages/shared/src/money.ts`, `sun.ts`, `format.ts` — computations and Indian formatting. Use these; do not reimplement.
- `apps/web/src/views/types.ts` — `ViewProps`: every stage view gets `{ state, bundle, dispatch, role, active }`.
- Server plugins: `apps/server/src/{voice,tools,desk}/plugin.ts` are registered in `app.ts`. Put routes in your plugin. Use `app.ctx` for config, features, content and the session store.

## Quality bar

- Strict TypeScript, no `any` unless unavoidable and commented. No magic numbers: name them.
- No content in components: every fact, label, price and coordinate comes from `/data` or `packages/shared`.
- UI follows section 11 of the plan: white canvas, Agora blue, accents per view (`apps/web/src/ui/accent.ts` — use the static class maps, never build Tailwind class names with template strings), Bricolage Grotesque for display, Plus Jakarta Sans for text, ink outlines and hard offset shadows (`shadow-[var(--shadow-pop)]`), lucide icons only. No gradients, glass, glows, emoji icons, lorem ipsum, or invented testimonials and statistics.
- Every state designed: loading, empty, error.
- Before finishing: `npx --no-install tsc -p <your package>/tsconfig.json` clean for the files you own, tests for logic you wrote (`vitest`), and no console errors in the views you built.

## Final report

End with: what you built (paths), how to see or test it, shared-contract changes, anything you could not finish or verify, and packages you need installed.

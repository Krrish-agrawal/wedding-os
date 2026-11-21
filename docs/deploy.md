# Deploying

The web app goes on **Vercel**. The API server goes on **Render**: it keeps WebSocket connections,
live call state in memory, a SQLite file and background timers, which Vercel's short-lived
functions cannot host. Vercel forwards `/api/*` to Render (`vercel.json`). The two WebSocket
connections go straight to Render (`VITE_WS_ORIGIN`), because Vercel cannot forward WebSockets.

Agora's voice agent calls the advisor's tools on Render's public address, so no tunnel is needed in
production.

## 1. Server on Render

1. Sign in at render.com with GitHub and allow access to this repository.
2. **New → Blueprint**, pick this repository. Render reads `render.yaml` and asks for every secret.
   The quickest way to fill them: open the service's **Environment** page, choose **Add from .env**,
   and paste your local `.env`.
3. Then make sure these values are the deployment ones (a pasted `.env` would overwrite them):

   | Key | Value |
   |---|---|
   | `SERVER_HOST` | `0.0.0.0` |
   | `SERVER_PORT` | `10000` |
   | `NODE_ENV` | `production` |
   | `PUBLIC_BASE_URL` | the service's address, e.g. `https://agora-virtual-estates-api.onrender.com` |
   | `WEB_ORIGIN` | the Vercel address from step 2 below |

4. Deploy. `https://<service>.onrender.com/api/health` should answer `{"ok":true,...}`.

If Render gives the service a different address (the name was taken), update it in `render.yaml`
(`PUBLIC_BASE_URL`), `vercel.json` (the `/api` rewrite) and `VITE_WS_ORIGIN` on Vercel.

The free plan sleeps after 15 minutes without traffic and takes about a minute to wake: open the
health address a few minutes before a demo. Its disk is temporary, so the Lead Desk starts empty
after each restart or redeploy.

## 2. Web on Vercel

1. Sign in at vercel.com with GitHub and **Add New → Project**, import this repository.
2. Leave the root directory as the repository root. `vercel.json` sets the install and build
   commands and the output folder.
3. Environment variables:

   | Key | Value |
   |---|---|
   | `VITE_WS_ORIGIN` | `wss://agora-virtual-estates-api.onrender.com` |
   | `VITE_AVATAR_MODE` | `human3d` |
   | `VITE_AVATAR_BODY` | `M` |

4. Deploy, then copy the address (e.g. `https://agora-virtual-estates.vercel.app`) into Render's
   `WEB_ORIGIN` and redeploy the Render service.

## Before sharing the link

The Lead Desk (`/desk`) has no sign-in: anyone with the link can see leads, including names, phone
numbers and emails typed on the landing page.

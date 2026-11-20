# Agora Virtual Estates

Tour homes and offices in Bengaluru on a live voice call. Shivam, an AI property advisor, talks with
the buyer and drives the screen while they speak: the 3D tour (where he walks the home with them),
the floor plan with wiring and plumbing, the neighbourhood, the commute, sunlight and Vastu, the
price with EMI and offers, the legal papers, and site-visit booking. When the buyer wants a person,
a human advisor joins the same call with live AI notes, and the whole pipeline (WhatsApp, email,
Slack, Jira, HubSpot) runs on its own.

Built for the Build with Agora hackathon, Bengaluru.

## What's inside

- **The call:** Agora Conversational AI (voice agent), Agora RTC and RTM, Murf Falcon voice, OpenAI
  for the advisor's reasoning. The advisor's tools are served over MCP. English, Hindi and Kannada.
- **The advisor:** a lip-synced 3D avatar (TalkingHead with HeadAudio) that also walks through the
  3D tour, or the brand mascot.
- **The views:** 3D tour (three.js), blueprint layers, locality and commute maps, sun path and
  Vastu, pricing and EMI, legal documents, visit booking.
- **For the sales team:** the Lead Desk with live calls, incoming-call alerts, human handoff with
  live notes and a copilot, a pipeline board, and an Integrations page.
- **A promo film:** made with Remotion; see `video/`.

Two sample properties: Larkspur Court (Indiranagar, for sale) and Fernhollow Garden Studio
(Koramangala, office lease). Listings and documents are fictional.

## Run it

You need Node 22.13 or newer and pnpm.

```bash
pnpm install
cp .env.example .env    # then fill in the keys you have
pnpm dev                # web on http://localhost:5173, API on http://localhost:8787
pnpm tunnel             # public URL so the Agora agent can reach the MCP tools
```

`.env.example` lists every setting with a short note. Agora, Murf and OpenAI keys are needed for
the voice call. Email, WhatsApp, Slack, Jira and HubSpot are optional; each shows as "Not
configured" until its keys are set.

Checks: `pnpm typecheck` and `pnpm test`. `pnpm reset` clears saved test leads.

## Layout

| Folder | What it holds |
|---|---|
| `apps/web` | React, Vite and Tailwind front end: landing page, call screen, views, Lead Desk |
| `apps/server` | Fastify API: sessions, voice agent, MCP tools, integrations, Lead Desk |
| `packages/shared` | Shared types, schemas and calculations |
| `data` | Property content: rooms, tour stops, prices, legal papers, localities |
| `docs` | Build plan, integrations plan and the voice runbook |
| `video` | Remotion source for the promo film |

## Credits

- 3D models: "Modern Apartment" by Visthétique and "Loft 18 mini office v.environment" by dasy444,
  from Sketchfab (credited in each property's `property.json` and shown in the tour).
- Fallback avatar: `mpfb.glb` from the TalkingHead project (CC0). The advisor avatar was made with
  Avaturn (free for non-commercial use).
- Maps: OpenFreeMap and OpenStreetMap contributors.

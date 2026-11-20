# Agora Virtual Estates: promo video

This folder holds a 70-second, 1920 × 1080, 30 fps motion-graphics promo. It is built entirely in code with [Remotion](https://www.remotion.dev): React components render each frame, and Remotion encodes the frames to MP4.

- **Output:** `out/agora-virtual-estates-promo.mp4`
- **Storyboard:** [STORYBOARD.md](STORYBOARD.md)

This folder is its own pnpm project. It is not part of the app's workspace, and it doesn't touch `apps/`, `packages/` or anything else in the repo. Every download stays inside `video/`:
- the package store: `.pnpm-store`, `.pnpm-cache`
- the packages: `node_modules`
- the headless browser Remotion renders with: `node_modules/.remotion`
- temporary files during a render: `.tmp`

## Re-render

From this folder:

```bash
pnpm install
```

```bash
pnpm render
```

`pnpm render` first regenerates the music (`public/music.wav`), then renders the film to `out/agora-virtual-estates-promo.mp4`. On the very first render, Remotion downloads its Chrome Headless Shell into `node_modules/.remotion`. A full render takes a few minutes.

To keep Remotion's temporary files inside this folder as well, prefix the command:

```bash
TMPDIR="$PWD/.tmp" pnpm render
```

### Preview and scrub

```bash
pnpm studio
```

This opens nothing by itself: it prints a local address (usually http://localhost:3000). Open it to scrub the timeline frame by frame.

### A single frame

```bash
pnpm still out/frame.png --frame=690
```

## Where to change things

| To change… | Edit |
|---|---|
| Any on-screen text, prices, offers, dates, captions | `src/content.ts` |
| Scene order and lengths | `src/timeline.ts`. The music follows the same file, so re-run `pnpm render`. |
| Brand colours and fonts | `src/theme.css`, which mirrors the tokens in `apps/web/src/styles.css` |
| The mascot drawing | `src/mascot/art.tsx`, a snapshot of `apps/web/src/ui/mascot/art.tsx`. Copy the app file over it to pick up new artwork. |
| Mascot poses and expressions | `src/mascot/Mascot.tsx`, which uses the same pose table as the app, driven by the frame number |
| A scene's layout or motion | `src/scenes/*.tsx`; the app views in the montage are in `src/views/*.tsx` |
| The music | `scripts/make-music.ts`, which synthesises it from sine, triangle and noise: no samples, no downloads |

## Notes

- Property facts (price, offers, documents, visit slots) match the sample data in `data/`. The EMI shown is computed from the app's defaults: 35% down, 7.75%, 20 years.
- Third-party names (Slack, Jira, HubSpot, WhatsApp, Murf) appear as plain text only. No logos are used.
- Remotion is free for individuals and small teams; see its license for company use.

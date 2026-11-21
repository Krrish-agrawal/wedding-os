# Brand assets

The product is **Agora Virtual Estates**. Its logo is a mascot built on a lowercase "a".
The owner supplies the final artwork; until then the app uses a stand-in drawn in code.

## What is here now

| File | What it is |
|---|---|
| `apps/web/src/ui/mascot/art.tsx` | The stand-in mascot drawing (SVG parts). Replace this when the artwork arrives. |
| `apps/web/src/ui/mascot/Mascot.tsx` | The `<Mascot>` component: states, motion, audio-driven bounce and arm gestures. Its API stays fixed. |
| `apps/web/src/ui/mascot/states.ts` | The list of states every artwork must cover. |
| `apps/web/src/ui/mascot/BrandMark.tsx` | Mascot glyph plus the "Agora Virtual Estates" wordmark. |
| `apps/web/public/brand/favicon.svg` | Browser tab icon (the stand-in glyph, idle). |
| `apps/web/public/brand/agora-logo.svg` | Agora's official wordmark, unmodified, from agora.io (`/_assets/logo/agora-logo-rgb-blue.svg`). Used in the landing hero. |

The Agora wordmark is the only third-party logo in the product; it is used as published, never redrawn.

## The stand-in

A heavy single-storey "a" in Agora blue (`--color-blue`, `#099DFD`) with a 3-unit ink outline and a
hard ink offset shadow, matching the cards and buttons. The letter's counter (its hole) is a white
face window holding the eyes and brows; there is no mouth and no cheek blush. Two stubby blue arms
with white mitten hands hang from the bowl and the stem, and two short legs with dark shoes stand
under the bowl. Expression comes from the eyes, brows, body and arms.

## The API (do not change)

```tsx
import { Mascot } from '@/ui';

<Mascot
  state="speaking"   // idle | listening | thinking | speaking | happy | apologetic | wave | surprised | wink | love | sleepy | cool
  level={0.6}        // 0–1 audio level; drives the bounce and arm gestures while speaking
  size={160}         // px or any CSS length ("100%")
  alive              // natural blinking (advisor tile only)
  shadow             // hard ink offset shadow (default true)
  title="Asha, your advisor" // accessible name; omit when decorative
/>
```

Where it appears: brand mark, landing, ringing screen, advisor presence (`call/PresenceSlot.tsx`,
mascot mode and fallback), handoff banner, empty and error states, the summary screen and the
narrow-window notice. Motion follows `prefers-reduced-motion`; nothing loops for attention except
the ringing wobble while a call is actually ringing.

| State | Face | Body |
|---|---|---|
| `idle` | open eyes | still, arms down |
| `listening` | eyes a touch larger, brows up | leans in (tilt left), arms open a little |
| `thinking` | eyes up and right, one brow raised | slight tilt right, right hand up by the stem |
| `speaking` | open eyes | small bounce and arm gestures with `level` |
| `happy` | "^ ^" eyes | one hop, both arms up |
| `apologetic` | worried brows | sinks and tilts, arms tucked in |
| `wave` | brows up | left hand waves twice, body sways |
| `surprised` | big eyes, brows up | small hop, arms out |
| `wink` | right eye winks | leans, right hand up |
| `love` | heart eyes | sways, arms tucked in |
| `sleepy` | closed eyes, floating "z"s | droops |
| `cool` | dark sunglasses | leans back, right hand up |

`seated` sits the mascot on a ledge (tilts pivot at the seat; legs dangle and swing), as on the
landing hero's rooftop. `MASCOT_SEAT_FRACTION` says where the seat is in its square box.

## Swapping in the owner's artwork

The motion layer only needs named parts and four pivot points, so the artwork is a file change.

**If the artwork comes as layered SVG (preferred).** Ask for one SVG with these layer ids, drawn on
a square artboard:

- `shadow` – the hard offset shadow under the letter
- `body` – the letterform with its outline
- `face-window` – optional; anything drawn over the body under the face
- `eyes-open`, `eyes-happy`
- `brows-raised`, `brows-worried`, `brows-quizzical` (optional; omit any the design does not use)
- `arm-left`, `arm-right` – each drawn hanging down from its shoulder
- `legs` – both legs and shoes

Then:

1. Put the source file in `assets/brand/` (for example `assets/brand/mascot-layers.svg`).
2. In `apps/web/src/ui/mascot/art.tsx`, replace the bodies of `MascotShadow`, `MascotBody`,
   `EyesOpen`, `EyesHappy`, `Brows`, `Arm` and `Legs` with the paths from the matching layers.
   Keep the function names and props.
3. Update `MASCOT_VIEWBOX` to the artboard, and `ANCHORS` to the new points: `base` (where the
   character stands, for tilts and hops), `leftShoulder` and `rightShoulder` (the arms' pivots)
   and `face` (eye centre).
4. Export a 32 x 32-friendly version of the idle character to `apps/web/public/brand/favicon.svg`.
5. Check every state in `/studio` or by setting `state` on a test page; run the web typecheck.

**If the artwork comes as a single flat logo.** Put it in `apps/web/public/brand/` and make
`MascotBody` render it as an `<image>` filling the viewBox, and have the face parts return `null`.
The states then show through body motion only (tilt, hop, bounce, sway). Ask the owner for the
layered version so the face can react.

**Colours.** If the owner's blue differs from `#099DFD`, change `--color-blue` (and `-deep`,
`-tint`) in `apps/web/src/styles.css`; the mascot, buttons and active states follow.

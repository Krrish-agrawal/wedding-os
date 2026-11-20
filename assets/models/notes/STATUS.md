# 3D workstream status

Coordinates everywhere are the optimised model's space: metres, Y up, origin at the centre of the
interior floor, y = 0 on the main floor. Plans are drawn with x to the right and z downwards.

## Ready for the Plans workstream

| What | Apartment (`apt-indiranagar`) | Office (`office-koramangala`) |
|---|---|---|
| Optimised model | `apps/web/public/models/apt-indiranagar.glb` | `apps/web/public/models/office-koramangala.glb` |
| Plan image | `apps/web/public/media/apt-indiranagar/plan.webp` (3048 × 936, 120 px/m, cut at 1.3 m) | `plan.webp` ground level (cut 1.3 m) and `plan-mezzanine.webp` (cut 3.89 m), both 2052 × 1512, 120 px/m |
| `plan.json` bounds | minX −12.7, maxX 12.7, minZ −3.9, maxZ 3.9 | minX −8.2, maxX 8.9, minZ −7.1, maxZ 5.5 (same for both levels) |
| `rooms.json` | Live: 7 rooms | Live: 9 rooms (5 ground level, 4 mezzanine) |
| North | `northOffsetDeg` 180 (model +Z is true north), entrance faces N | `northOffsetDeg` 0, entrance (glazed door in the east curtain wall) faces E |

Plan images show cut walls as ink lines (6 cm), furniture from above in natural colour, white
background. They are framed exactly to `bounds`: pixel (u, v) maps to
x = minX + u / width · (maxX − minX), z = minZ + v / height · (maxZ − minZ).

## Multi-level office

The office is a two-level loft: a ground level at y = 0 and an L-shaped mezzanine at y = 2.59 over
the west wing and the south strip. A double-height void covers the lounge. Shared contract change
(additive): `Property.levels` (index, name, floorY, planImage) and `Room.level` (index into levels,
default 0). Rooms on different levels may overlap in x/z.

## Measured areas (sum of room polygons)

- Apartment: 153.9 m² = 1,657 sq ft (Money has carpet 585 sq ft).
- Office: ground 122.6 m² + mezzanine 63.8 m² = 186.4 m² = 2,006 sq ft (Money has carpet 860 sq ft).
- Office desk seats visible in the model: 6 (2 on the ground level, 4 on the mezzanine). Money has 10.

## Also done

- Tour stops: apartment 7 (entrance, dining, living, kitchen, study, bedroom, bathroom) and office 8
  (lounge, meeting, breakout, bay-1, bay-2, cafe, mezz-work, mezz-meeting), each with an overview.
  Every stop's `via` is a walk from the main circulation (apartment: gallery/dining junction; office:
  lounge, then the stair for the mezzanine). The tour skips any via point it can see past at eye
  level, so moves between any two stops avoid walls.
- Hero images: `apps/web/public/media/<id>/hero.webp`, 1600 × 1000, from the living-room stop
  (apartment) and the lounge stop (office).
- The apartment plan was re-rendered after the bookcase moved to furnishing and the en-suite door was
  opened; bounds are unchanged.

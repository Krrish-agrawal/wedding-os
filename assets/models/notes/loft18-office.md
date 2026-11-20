# Loft 18 mini office (environment version) → `office-koramangala`

"Loft 18 mini office v.environment" by dasy444, Sketchfab Standard licence (credit line in
`license.txt`, copied into `property.json.credits`). Full machine report: `loft18-office.inspect.md`.

## Source (raw glTF)

| What | Value |
|---|---|
| Size on disk | 21 MB (scene.bin + 25 textures, 15.6 MB of them) |
| Nodes / meshes / materials / textures | 452 / 259 / 29 / 25 |
| Triangles | 115,591 (about 76k of them are the street and garden outside) |
| Cameras, punctual lights | none, none |
| Up axis, scale | Y up, metres (FBX cm × 0.01, no viewer scale) |
| Materials | all double-sided; glass is a 34 % grey blend; tree billboards use alpha |
| Names | generic (`Cube.037`, `Plane.074`, `node_0.012`); identified by position and material |

Scale check: desk tops 0.72 m, chair seats 0.41 m, stair risers 0.15 m with 0.26 m treads, ground
ceiling under the mezzanine 2.44 m, mezzanine floor 2.59 m, roof 4.83 m. Metric as delivered.

## What is in the model

An independent two-level loft standing in a walled garden at street level (grass, palms, a road on
the east side, apartment blocks around).

Ground level (y = 0):
- **Double-height lounge**: sectional sofa, lounge chairs around a round table, a long sofa under the
  stair, full-height steel-framed glazing on the north and east walls with the glazed entrance door
  on the east, open-tread wooden stair to the mezzanine.
- **Meeting area** under the mezzanine: oval table with six chairs, large wall-mounted screen over a
  white sideboard, wood ceiling.
- **Breakout lounge** (south-west): L-shaped sofa beside a full-height window, full-height built-in
  storage cupboards (the white block west of the meeting area), a long wooden counter.
- **Work bay 1** and **Work bay 2** (south strip, open-fronted): bay 1 has an L-shaped desk, one office
  chair and a wall-mounted screen; bay 2 has a desk, one office chair and a window.

Mezzanine (y = 2.59), an L over the west wing and the south strip with a glass balustrade:
- **Mezzanine café**: three round tables with two chairs each.
- **Mezzanine lounge**: sofa, pouf, round rug.
- **Mezzanine workspace**: two desks with two office chairs each, wall shelves, a window.
- **Mezzanine meeting room**: round table with four chairs, windows on two sides.

Desk seats (chairs at desks): 2 on the ground level, 4 on the mezzanine, **6 in total**. Meeting and
café seats are not counted. Rooms: `data/properties/office-koramangala/rooms.json` (9 rooms; ground
122.6 m² + mezzanine 63.8 m² = 186.4 m² = 2,006 sq ft).

## Optimisation

| | Before | After |
|---|---|---|
| File | 21 MB glTF + textures | 3.7 MB GLB |
| Triangles | 115,591 | 115,591 (no simplification needed) |
| Draw calls | 259 | 34 |
| Texture bytes | 14.9 MB | 1.7 MB WebP (all at or below 1024) |

Groups: `Structure` (walls, floors, mezzanine slab, stair, glazing, frames, cupboard fronts),
`Furnishing` (furniture inside the footprint, plus the roof pergola), `Exterior` (anything reaching
outside the building footprint: garden, trees, road, neighbouring blocks, boundary walls).

## Normalisation

Metres, Y up, origin at the centre of the building footprint (x −7.4…8.2, z −2.9…7.3 in the source),
y = 0 on the ground-level floor. Raw → model: `p_model = p_raw_world − (0.4, 0, 2.2)`.
`property.json.levels`: Ground level (y 0, `plan.webp`) and Mezzanine (y 2.59, `plan-mezzanine.webp`).

North: `northOffsetDeg` 0 (model −Z is true north), `entranceFacing` "E": the glazed entrance door is
in the east curtain wall facing the street. The double-height glazing faces north (soft light) and east
(morning sun); the breakout lounge window faces west.

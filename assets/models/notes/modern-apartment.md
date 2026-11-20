# Modern Apartment → `apt-indiranagar`

"Modern Apartment" by Visthétique, CC BY 4.0, from Sketchfab (credit line in `license.txt`, copied
into `property.json.credits`). Full machine report: `modern-apartment.inspect.md`
(`tsx scripts/models/inspect.ts assets/models/raw/modern-apartment/scene.gltf`).

## Source (raw glTF)

| What | Value |
|---|---|
| Size on disk | 286 MB (scene.bin + 85 textures, 128 MB of them) |
| Nodes / meshes / materials / textures | 288 / 241 / 101 / 85 |
| Triangles | 2,991,575 |
| Cameras, punctual lights | none, none |
| Up axis | Y up (Sketchfab root node rotates the FBX's Z-up) |
| Scale | FBX node scales cm → m (0.01); the Sketchfab root adds a 0.853 viewer scale |
| Materials | all double-sided; PBR, no baked lighting; one emissive (MacBook screen) |
| Structure | one node `Plane.002` holds walls, floors (wood, two marbles), the bathroom stone tiles, a single ceiling quad and a black outer shell; doors, windows, baseboard and wardrobes are separate named nodes |
| Furniture | separate named top-level objects (CouchSet, Bed, DiningTable.001, KDecor, Plants, …) |

Where the triangles were: one interior door (`Door.001`) alone was 1,137,856 triangles; plants
289k, bathroom accessories 273k, kitchen props 218k, sofa set 179k, bed 137k, bookcase 113k.

### Scale check (after removing the 0.853 viewer scale)

Ceiling 2.97 m, dining table top 0.76 m, sofa seat 0.40 m, mattress 2.02 × 2.07 m, washer top 0.85 m,
desk surface 0.70 m, interior door opening 2.40 m, front door 2.86 m, kitchen counter 0.70 m (low in
the source). With the 0.853 scale the doors read 2.05 m but the ceiling drops to 2.53 m, the table to
0.65 m and the mattress to 1.72 m long, so the viewer scale is removed.

## What is in the model (seen in the studio, plan render at 1.3 m)

A long single-level home, 24.4 m × 7.0 m outside, one bedroom:

- **Entrance gallery** along the whole south side, wood floor, a dark wood-clad wall with framed art,
  a shoe cabinet beside the front door (east end).
- **Living room** at the west end: grey L-shaped sofa set, glass coffee table, two white lounge
  chairs, patterned rug, floor lamp, tall speaker, full-height black-framed windows with sheer
  curtains and roman blinds on two sides.
- **Dining area**: six-seat wooden table with white chairs, two pendant lights.
- **Kitchen**: a linear run of wood cabinets along the north wall (about 10 m), hob with a glass
  chimney hood, sink, built-in oven, dishwasher, tall fridge, coffee station.
- **Study**: desk with a desktop computer and office chair against a full-height window, bookshelves
  with plants, black-and-white geometric rug; open to the dining area and to the gallery.
- **Bedroom**: king-size bed against a wood-panelled wall, rug, bedside lights, full wardrobe wall.
- **Bathroom** (en-suite, through a passage in the wardrobe wall): rain shower behind a glass screen,
  WC, marble vessel basin on a wood vanity, heated towel ladder, washer and dryer stacked in a niche.

No balcony. Room polygons, areas and features are in `data/properties/apt-indiranagar/rooms.json`
(7 rooms, 153.9 m² = 1,657 sq ft in total).

## Optimisation (`scripts/models/optimize.ts`, settings in `models.config.ts`)

| | Before | After |
|---|---|---|
| File | 286 MB glTF + textures | 14.0 MB GLB |
| Triangles | 2,991,575 | 469,166 |
| Draw calls (primitives) | 241 | 102 |
| Materials / textures | 101 / 85 | 93 / 81 |
| Texture bytes | 128 MB (PNG/JPEG up to 4096²) | 6.3 MB WebP |
| Load and parse (local dev server) | — | about 0.2 s after download |

Steps: normalise, flatten, regroup into `Structure` and `Furnishing`, weld, simplify per object,
join by material inside each group, textures to WebP, Meshopt compression (`EXT_meshopt_compression`
+ quantisation); the tour's GLTFLoader uses three's `MeshoptDecoder`.

- Simplification uses meshoptimizer's permissive mode (collapses across UV/normal seams; the source is
  heavily seamed so the default mode removed almost nothing). Door 1% / 0.4% error; dense decor 15% /
  0.6%; hero furniture 30% / 0.3%; architecture is welded only.
- Textures: hero colour maps (floors, walls, wood, marble, stone) at 2048; floor normal and roughness
  maps at 1024; other normal and roughness maps at 512; small props at 512; everything else at 1024.
  Encoded by gltf-transform's built-in fallback encoder (ndarray-pixels, backed by the sharp build it
  already depends on), default WebP quality.
- Before/after: the studio loads the raw source and the GLB in the same normalised space (Shots tab,
  "Raw source"). The same living-room view (sofa set, windows, curtains, rug, painting) shows no
  visible difference. Every tour stop was then reviewed in the optimised model: walls, windows and
  hero furniture hold their shape; dense decor (plants, kitchen props) is lighter but reads the same
  at tour distance.

Two deliberate changes to the scene, both for the tour:

1. The en-suite door was closed in the source; its leaf and handle are swung open 92° into the
   bathroom so the camera walks through a doorway rather than a closed door.
2. The black outer shell behind every window is repainted as a self-lit soft daylight grey, so windows
   read as daylight instead of a black void, and the dollhouse overview shows light exterior walls.

## Normalisation

Metres, Y up, origin at the centre of the walls' footprint, y = 0 on the living-room marble floor (the
bedroom and bathroom floors sit 9–10 cm lower in the source). Baked into the GLB, so
`property.json.model` is identity. Raw → model: `p_model = (p_raw_world − (3.8782, 0.2285, 1.4802)) × 1.172347`.

North: `northOffsetDeg` 180 (model +Z is true north), `entranceFacing` "N". The front door is on the +Z
wall, so the entrance faces north, the living room sits at the east end with east-facing windows, the
bedroom and bathroom are on the west, and the kitchen run is on the south wall.

# Studio assets: audit, status, licences

## Audit (before this pass) and fixes

| Asset | Problem | Fix |
|---|---|---|
| Traditional mandap | Four plain cylinders, one flat cone, balls for flowers; no base, capitals or finials | Plinth, fluted pillars with capitals, valance, three-tier pyramidal canopy with a brass band, kalash finials, havan kund, instanced garlands that sag, flower fringe |
| Wedding stage | A box with a carpet slab | Plinth edges, inset tiered border, carpet runner on the front face (kept inside the catalogue footprint, so collision is unchanged) |
| Floral wall panel | 48 flat balls on a grid | Backing board and rail, 70 leaves and 150 varied blooms, one instanced draw call each |
| Entrance arch | Posts, torus, 16 balls | Plinth bases, tapered posts with finials, 34 varied blooms on the arc, hanging strands, loose petals |
| Marigold garland curtain | Spheres on straight sticks | Instanced marigold strands with sag and jitter |
| Flower arrangement | 10 balls | Vase with rim, stem, 26 varied blooms domed in a spiral |
| Chair | Slab and four box legs | Cushioned seat with frame, padded back with top rail and rear posts, tapered legs |
| Chandelier | Ring and 20 small balls | Two rings, 12 arms with candle cups, emissive bulbs, hanging crystal drops (no per-chandelier point lights, to keep the light count low) |
| Venue lighting | Ballroom had nothing beyond the sun and ambient | Two soft warm point lights in the ballroom (courtyard keeps six; the lawn none) |
| Sofa, jhula, rangoli, lamps, lanterns, table, runner, fairy curtain | Acceptable at scene distance | Unchanged |

Footprints stay within the catalogue size (a test checks every model); part ids are unchanged, so recolouring and collision work as before. Repeated blooms use `InstancedMesh` (`Blooms` in models.tsx): one draw call per group, one material per object.

## GLB support (glb.tsx)
`withGlb` swaps in a GLB for a catalogue id only when `assets/registry.json` lists it. The GLB is scaled to the catalogue footprint, materials are cloned per instance (cached scenes are never mutated), parts can be recoloured through `materialParts` (catalogue part id to GLB material name), and the procedural model is the fallback while loading, on error, or when nothing is registered.

## Licence registry (assets/registry.json)
**Currently empty: no GLB has been added.** No specific model's page, licence and direct download were verified, so none was fetched. Rules for adding one: CC0, CC-BY 4.0 (attribution recorded and shown via `creditsFor`), MIT or Apache-2.0 only; never CC-NC/ND, unknown, or Sketchfab "Standard"; read the licence on the asset's own page; record `sourceUrl`, `author`, `licence`, `licenceUrl`, `checkedOn`, `sha256`; file under `apps/web/public/models/wedding/`, under 1.5 MB. A unit test enforces this for every entry. `creditsFor()` exists, but no in-app Credits note is rendered yet because there is nothing to credit.

## Known limits
- Everything is still low-poly procedural geometry: no textures, carving or embroidery, no realistic fabric drape or flower heads.
- The stage has no protruding steps (they would leave the collision footprint).
- Blooms in one instanced group share one colour.

# Maps notes

Decisions, terms and provenance for the Locality and Commute views, the map data scripts and the
live route lookup. Checked on 2026-11-20 against each provider's own pages.

## Map tiles

The map tries each source in order and steps down when it fails: a style or TileJSON that does not
load (a rejected key, a dead URL), three failed tiles before any loads, or twelve failed tiles in all.
URL styles are fetched by our engine rather than by MapLibre, because MapLibre waits for a failed style
to "load" before it will swap in the next one. A small "Satellite unavailable · street map" tag shows
when the map has fallen back from satellite. If every source fails, the map keeps drawing pins and
routes on a plain surface and says the imagery is not loading. Both fallbacks were tested by pointing
the first tier at a bad key and a dead style URL.

| Order | Source | Needs | Terms that matter | Attribution shown |
|---|---|---|---|---|
| 1 | **MapTiler Satellite** (`satellite-v2` raster tiles via TileJSON) | `VITE_MAP_TILES_KEY` | Free plan: "No credit card needed"; 100,000 requests and 5,000 sessions a month, service pauses when exceeded; described as for "testing, PoC, prototyping, personal, or non-commercial use". | `© MapTiler © OpenStreetMap contributors` (linked), plus the MapTiler logo linking to maptiler.com, which the free plan requires. |
| 2 | **OpenFreeMap** `liberty` style (street map, vector) | nothing | Free, no key or registration. Offline downloads limited to 3,000 tiles / 50 MB; we never download areas. | From the style's TileJSON: `OpenFreeMap © OpenMapTiles Data from OpenStreetMap`. |
| 3 | **OpenStreetMap standard tiles** | nothing | Light interactive use only; "pre-emptive fetching of tiles other than those a user is actively viewing" is prohibited, so the parked map gets zero size on this tier and never preloads. | `© OpenStreetMap contributors` (linked). |

Not used:

- **Esri World Imagery without a key.** Esri's terms summary for ArcGIS Online items (linked from the
  World Imagery item, `licenseInfo`) says Esri content is used "in conjunction with Esri software or an
  ArcGIS Online subscription", and "if you do not have Esri software, you must purchase an ArcGIS Online
  subscription". Anonymous use from MapLibre is therefore outside its terms. With an ArcGIS Location
  Platform API key (free tier) it could be added as a satellite tier using
  `https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=…`
  with the credit `Powered by Esri | Esri, Vantor, Earthstar Geographics, and the GIS User Community`
  (the service's current `copyrightText`).
- **Stadia Maps**: satellite is on paid plans only.

Setup for satellite: create a free MapTiler account, create a key restricted to the app's origins,
and set `VITE_MAP_TILES_KEY`. Note that Vite reads `.env` from `apps/web/` (its project root) unless
`envDir` points at the repository root.

Sources: https://www.maptiler.com/cloud/pricing/ · https://docs.maptiler.com/guides/map-design/attribution/add-attribution/ ·
https://www.maptiler.com/copyright/ · https://openfreemap.org/quick_start/ · https://openfreemap.org/tos/ ·
https://operations.osmfoundation.org/policies/tiles/ ·
https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9 ·
https://www.esri.com/content/dam/arcgisonline/docs/tou_summary.pdf ·
https://developers.arcgis.com/maplibre-gl-js/maps/raster-tile-basemaps/display-multiple-basemap-layers/

## One map for the whole call

Creating a MapLibre map takes far longer than the 150 ms view-switch budget, so
`apps/web/src/views/maps/engine.ts` keeps a single map:

- The library loads lazily (`import('maplibre-gl')`, worker via `setWorkerUrl` with Vite's `?url`).
- While the call rings, a call preloader creates the map in an off-screen parking element; whenever a
  property is opened, the parked map jumps to it at the locality zoom so its tiles are cached.
- A view borrows the map with `useMapHost`: the map's container element moves into the view in a
  layout effect (before paint) and moves back to the parking element on unmount. The WebGL context,
  style and tile cache survive every switch.
- Markers are React portals inside MapLibre markers (`MapMarker`); the route is one GeoJSON source
  with an ink casing and a tangerine line, added to every base style we apply and re-sent if it
  changed while a style was loading.
- Pin labels are decluttered on every `moveend`: the selected place, then the nearest, win; a label
  never covers another pin or the property pin. Hidden labels appear on hover or focus.
- Measured in the studio (1440×900): clicking a dock chip to the Locality or Commute view mounted the
  view with the map attached in about 50 ms, with no long tasks. The stage's own cross-fade
  (`AnimatePresence mode="wait"`, 160 ms exit) is outside this budget and owned by the stage.

## Locality data

- **Places** come from OpenStreetMap through Overpass (`scripts/maps/fetch-places.ts`): one query per
  locality (bounding boxes, cheap for the server; exact radii applied locally), named features only,
  mapped to the six categories, de-duplicated by name, spaced at least 120 m apart so pins stay
  legible, nearest first: up to 10 schools and 8 of everything else. Transit always includes the two
  nearest operating metro stations within 4 km, the nearest railway station, bus stations within 2 km,
  then bus stops. Groceries lead with up to four supermarkets. Features with construction, proposed or
  disused tags are skipped, as are school names clipped by a bulk import ("Eng Sch", "GHPS"). After
  review, mis-tagged features (a company tagged as a school, clinics and wellness centres tagged as
  hospitals, shoe and courier shops tagged as convenience stores, generic labels such as "BBMP Park")
  are listed with reasons in `EXCLUDED_OSM_IDS` in `scripts/maps/places-config.ts`. Metro stations
  named only after their area get "metro station" added. Each place keeps its `osmId`.
- Raw responses are cached in `scripts/maps/.cache/` so the data can be rebuilt and reviewed without
  new requests (add it to `.gitignore` if you do not want them committed). Data as fetched on
  2026-11-20 (OSM base timestamp in each cached response).
- On 2026-11-20 the main Overpass instance refused connections for a while after a request with a
  long descriptive User-Agent got HTTP 406; the private.coffee and VK mirrors were overloaded. The
  query that finally ran went to `overpass-api.de` with the User-Agent in `scripts/maps/lib.ts`.
- Places are © OpenStreetMap contributors (ODbL). The credit shows in the Locality panel and in the
  map attribution.
- **Profiles** are written by hand from the sources listed in each `data/localities/<id>.json`.
  Claims are kept to what the sources say, with dates for news reports.

Overpass etiquette: the public instance asks for at most about 10,000 requests a day and a realistic
`[timeout:…]`; we send two queries per full run, one at a time, with a pause between them.
Source: https://dev.overpass-api.de/overpass-doc/en/preface/commons.html

## Commute data

- **Presets** (`scripts/maps/precompute-routes.ts`) are driving routes from the public OSRM demo server
  (`router.project-osrm.org`), requested at most once every 1.5 s, cached to disk, simplified to at most
  220 points within 12 m. Destination points are from OpenStreetMap (ids in
  `scripts/maps/destinations.ts`); the nearest metro station is taken from the cached Overpass response
  (Indiranagar for the apartment; Suddaguntepalya, the Pink Line stop that opened on 14 November 2026,
  for the office). Route ids: `office` or `home` (the other property, with `propertyId`),
  `nearest-metro`, `airport`, `majestic-bus-station`, `city-railway-station`, `mg-road`,
  `manyata-tech-park`, `embassy-techvillage`, `electronic-city`.
- OSRM's fastest route between the two properties runs north via CMH Road and Richmond Road
  (9.3 km one way, 8 km back) rather than the direct Inner Ring Road; that is what the current
  OpenStreetMap road data gives, and it is stored unchanged.
- **OSRM durations are free-flow**: no traffic. They are stored as given, and every commute file's
  `note` says the times are estimates without heavy traffic. Bengaluru peak-hour trips take longer.
- OSRM demo server policy: "reasonable, non-commercial use", at most one request per second, no
  guarantees of uptime. Source: https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server
- The route between the two properties carries `propertyId`, so the view names the other property.

## Live routes (`apps/server/src/maps/live.ts`)

`findRoute(origin, query, { signal })` geocodes with Nominatim, then routes with OSRM. It never
throws, gives up after 4 s in total, caches results in memory (a day for hits, ten minutes for misses),
shares identical in-flight lookups, and returns `null` on any failure. Of the top five geocoder
results it prefers one named exactly as asked ("Whitefield" the area, not "Whitefield (Kadugodi)"
the station). Checked live: "Whitefield" from the apartment returned 17.4 km / 19 min in about 1.5 s;
the repeat came from cache.

**Nominatim usage policy — read it before changing this module:
https://operations.osmfoundation.org/policies/nominatim/**

- Absolute maximum of one request per second for the whole app: enforced by a shared limiter; a
  lookup that would have to wait past its budget gives up instead.
- An identifying User-Agent (`AgoraVirtualEstates/0.1 (AI property advisor demo)`, override with
  `MAPS_USER_AGENT`); stock library agents are not acceptable. Add a contact address there if the
  service operators ask for one.
- No autocomplete or as-you-type queries: lookups run only when the advisor's `show_commute` tool
  names a place that is not a preset.
- Results are cached; repeated identical queries are served from memory.
- No personal data: queries that look like an email address or a phone number are never sent.
- It must be possible to switch the service off without a code change: `MAPS_LIVE_ROUTES=off`.
- Searches are bounded to the Bengaluru area (`viewbox` + `bounded=1`, `countrycodes=in`).
- The owner should confirm they accept this policy for the demo; for anything larger use a
  commercial geocoder or a self-hosted Nominatim.

Optional server environment variables: `MAPS_LIVE_ROUTES` (`off` disables), `MAPS_GEOCODER_URL`,
`MAPS_ROUTER_URL`, `MAPS_USER_AGENT`. Script-only: `OVERPASS_URL`, `OSRM_URL`, `MAPS_DATA_USER_AGENT`.

## Regenerating the data

```sh
npx --no-install tsx scripts/maps/fetch-places.ts        # add --refresh to query Overpass again
npx --no-install tsx scripts/maps/precompute-routes.ts   # add --refresh to query OSRM again
pnpm --filter @ave/server validate:data
```

Both scripts keep hand-written fields (locality profiles and sources) and rewrite only the data they own.

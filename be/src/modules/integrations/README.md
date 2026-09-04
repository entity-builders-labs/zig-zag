# Integrations Module

External service integrations, split into four submodules: `google-places` (Places search, provider-neutral), `osm` (Nominatim destination resolution + Overpass streets/boundaries), `wikidata` (content-safety check only — see below), and `photos` (a photo-provider abstraction, currently unused by the live media path — see below).

## Architecture

```
integrations/
├── google-places/
│   ├── dto/crawl-location.dto.ts
│   ├── interfaces/places-api.interface.ts   # IPlacesApiService
│   ├── services/
│   │   ├── google-places-api.service.ts     # Direct Google Places API calls
│   │   ├── geoapify-places-api.service.ts   # Direct Geoapify API calls (alternative provider)
│   │   └── cached-places-api.service.ts     # Cache wrapper (implements IPlacesApiService)
│   └── utils/catalog-acquisition-plan.util.ts, catalog-place-taxonomy.ts, price-level.util.ts
├── osm/
│   ├── services/
│   │   ├── nominatim-api.service.ts, cached-nominatim-api.service.ts  # Destination boundary resolution
│   │   ├── overpass-api.service.ts, cached-overpass-api.service.ts   # Streets/boundaries/POIs
│   │   ├── osm-places.service.ts            # Resolves ExperienceCandidate componentHints → OSM features
│   │   └── osm-membership.service.ts        # Bounded exact containment (is point X inside area Y)
│   └── utils/geojson-containment.util.ts, osm-geometry.util.ts
├── wikidata/
│   ├── services/wikidata-api.service.ts, cached-wikidata-api.service.ts
│   └── utils/wikidata-content-safety.util.ts
├── photos/                                  # See "Photo providers" below — not wired to the live path
│   └── providers/hybrid-, wikimedia-, google-places-, serpapi-, mock-photo.provider.ts
└── integrations.module.ts
```

## Places acquisition

The Experience acquisition path (`ExperienceCatalogService.acquireNearbyAsExperiences`, `experience-generation.service.ts`) is the only real caller of `'PlacesApiService'` today. There is no crawler/background-population job — Places acquisition happens inline during a live Tour generation request, gated by `CoverageAnalyzer`.

`IPlacesApiService` is provider-neutral: `GooglePlacesApiService` (default) or `GeoapifyPlacesApiService` (explicit alternative), selected by `PLACES_PROVIDER` and wrapped by `CachedPlacesApiService`.

## Caching Layer

`CachedPlacesApiService` (and the equivalent `CachedNominatimApiService`/`CachedOverpassApiService`/`CachedWikidataApiService`) implement their real provider's interface and wrap it:

- Cache keys include provider, schema version, method, and normalized params.
- `read`: cache first, live provider on miss, without writing.
- `write`: cache first, live provider on miss, then write.
- `strict`: cache only; a miss fails without an external call.
- Injected via a `'...ApiService'` NestJS provider token per integration.

## Destination resolution and OSM (`osm/`)

`NominatimApiService` resolves a destination label to a real administrative boundary or a synthetic point-radius scope. `OverpassApiService` fetches streets/boundaries/POIs used to resolve a multi-component Experience's `componentHints` (`OsmPlacesService`) and to check exact containment (`OsmMembershipService`, e.g. "is this discovered venue really inside San Telmo").

## Wikidata (`wikidata/`) — content-safety only, not narrative enrichment

Despite the module name, Wikidata is **not** used to enrich an Experience's description today — `wikidata-content-safety.util.ts`'s prompt is the only live consumer, used as a safety check during composite-Experience resolution. (An earlier Activity-era feature enriched a composite variant's description from a Wikidata QID; that specific enrichment path was removed with the domain cutover.)

## Photo providers (`photos/`) — built but currently unused

A complete, config-driven photo-provider abstraction exists here (`'PhotoEnrichmentProvider'` token, switchable via `PHOTO_PROVIDER` between `hybrid`/`wikimedia`/`serpapi`/`google_places`/`mock`, including a real `GooglePlacesPhotoProvider`) — but **nothing in `be/src/modules/media` or `be/src/modules/tours` calls it**. The live media-enrichment path (`MediaEnrichmentProcessorService`, see `CLAUDE.md`) independently reimplements a narrower Wikimedia-only fetch via a *different* class (`media/services/wikimedia-commons.service.ts`), duplicating what this module already does more capably. Wiring `MediaEnrichmentProcessorService` to this module's `PhotoEnrichmentProvider` (instead of its own bespoke Wikimedia client) is the fastest path to adding real Google Places photos — the provider already exists, it's just not called.

## Environment Variables

- `PLACES_PROVIDER` — `google` (default) or `geoapify`; invalid values fail startup.
- `GOOGLE_MAPS_API_KEY` — required when `PLACES_PROVIDER=google`.
- `GEOAPIFY_API_KEY` — required when `PLACES_PROVIDER=geoapify`.
- `USE_MOCK_MAPS` / `MOCK_MAPS_MODE` (`read`/`write`/`strict`) — shared cache-mode toggle reused by Places/OSM/Wikidata so tests/CI never hit them unintentionally.
- `OVERPASS_API_URL` / `OVERPASS_TIMEOUT_MS` / `OVERPASS_MAX_RADIUS_METERS` / `OVERPASS_MAX_CONCURRENCY`, `WIKIDATA_API_URL`.
- `PHOTO_PROVIDER` — selects the (currently unused) `photos/` provider; irrelevant until `MediaEnrichmentProcessorService` is wired to it.

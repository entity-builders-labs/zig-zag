# Integrations Module

External service integrations. The catalog-refill orchestrator uses a
provider-neutral Places contract backed by Google Places (MVP default) or
Geoapify (explicit alternative).

## Architecture

```
integrations/
├── google-places/
│   ├── google-places.service.ts         # Main crawling orchestrator
│   ├── dto/
│   │   └── crawl-location.dto.ts        # Crawl request params
│   ├── interfaces/
│   │   ├── google-places.interface.ts   # Place type definitions
│   │   └── places-api.interface.ts      # IPlacesApiService interface
│   └── services/
│       ├── google-places-api.service.ts # Direct Google API calls
│       └── cached-places-api.service.ts # Cached wrapper (implements IPlacesApiService)
└── integrations.module.ts
```

## Google Places Crawling Pipeline

The crawling flow is triggered in background by `HybridSearchService` when a new area is searched:

1. **`GooglePlacesService.crawlAndSaveActivities(dto)`**
2. Searches the configured Places provider for activity categories (restaurants, parks, museums, etc.)
3. For each place found:
   - Filters by minimum rating
   - Matches to known activity types (static mapping)
   - Falls back to **AI classification** if no static match (`classifyActivityCategoryWithAI()`)
   - Fetches detailed place info (photos, reviews, opening hours)
4. Saves activities to PostgreSQL via `ActivitiesService.createMany()`
5. Generates embeddings and stores them via `VectorStoreService` (pgvector)
6. Records a `CrawlerSearch` entry to prevent re-crawling the same area within 24h

## Caching Layer

`CachedPlacesApiService` implements `IPlacesApiService` and wraps the selected
real provider:

- Cache keys include provider, schema version, method, and normalized params.
- `read`: cache first, live provider on miss, without writing.
- `write`: cache first, live provider on miss, then write.
- `strict`: cache only; a miss fails without an external call.
- Injected via NestJS provider token `'PlacesApiService'`

## Known Activity Types

On module init, `GooglePlacesService.ensureKnownActivityTypes()` seeds the DB with a fixed set of activity categories (e.g., "restaurant", "museum", "park", "nightlife") used for classification.

## Environment Variables

- `PLACES_PROVIDER` — `google` (default) or `geoapify`; invalid values fail startup.
- `GOOGLE_MAPS_API_KEY` — required when `PLACES_PROVIDER=google`.
- `GEOAPIFY_API_KEY` — required when `PLACES_PROVIDER=geoapify`.
- `USE_MOCK_MAPS` — enables the cached wrapper for legacy compatibility.
- `MOCK_MAPS_MODE` — `read`, `write`, or `strict`.

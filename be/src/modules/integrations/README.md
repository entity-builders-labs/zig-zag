# Integrations Module

External service integrations. Currently contains the **Google Places** integration for crawling and enriching activity data.

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
2. Searches Google Places API for various activity categories (restaurants, parks, museums, etc.)
3. For each place found:
   - Filters by minimum rating
   - Matches to known activity types (static mapping)
   - Falls back to **AI classification** if no static match (`classifyActivityCategoryWithAI()`)
   - Fetches detailed place info (photos, reviews, opening hours)
4. Saves activities to PostgreSQL via `ActivitiesService.createMany()`
5. Generates embeddings and stores them via `VectorStoreService` (pgvector)
6. Records a `CrawlerSearch` entry to prevent re-crawling the same area within 24h

## Caching Layer

`CachedPlacesApiService` implements `IPlacesApiService` and wraps `GooglePlacesApiService`:

- Caches API responses to reduce Google Places API costs
- Injected via NestJS provider token `'PlacesApiService'`

## Known Activity Types

On module init, `GooglePlacesService.ensureKnownActivityTypes()` seeds the DB with a fixed set of activity categories (e.g., "restaurant", "museum", "park", "nightlife") used for classification.

## Environment Variables

- `GOOGLE_MAPS_API_KEY` — Google Places API key (required)

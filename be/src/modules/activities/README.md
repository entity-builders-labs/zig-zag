# Activities Module

Manages the core `Activity` entity — places, restaurants, attractions, etc. Provides CRUD, geospatial queries, hybrid search with background crawling, and AI-powered metadata/similarity features.

## Architecture

```
activities/
├── controllers/
│   └── activities.controller.ts     # REST API endpoints
├── dto/
│   ├── create-activity.dto.ts
│   ├── update-activity.dto.ts
│   ├── find-all-activities.dto.ts
│   ├── find-nearby.dto.ts
│   ├── hybrid-search.dto.ts
│   ├── activity-metadata.dto.ts
│   └── activity-response.dto.ts
├── interfaces/
│   ├── activity.interface.ts        # ActivityWithDistance, CreateManyResult
│   ├── google-places.interface.ts
│   └── location.interface.ts
├── services/
│   ├── activities.service.ts        # Core CRUD + geospatial queries
│   ├── hybrid-search.service.ts     # Search + background crawling
│   ├── activity-metadata.service.ts # AI metadata generation
│   └── activity-relationship.service.ts # Activity compatibility scoring
└── activities.module.ts
```

## Key Flows

### Hybrid Search (Primary FE flow)

This is the main search endpoint used by the mobile app on every map interaction:

1. **`POST /activities/search-hybrid`** → `HybridSearchService.searchActivitiesWithCrawling()`
2. Queries existing activities from PostgreSQL by proximity (Haversine formula)
3. Optionally filters by activity type
4. Checks if background crawling should be triggered:
   - Looks for a recent `CrawlerSearch` record within ~1km and 24h
   - If none found → triggers **background** Google Places crawling (non-blocking)
5. Returns immediately with DB results + `crawlingTriggered` flag

### Geospatial Queries

`ActivitiesService.findAll()` and `findNearbyActivities()` use:

- Haversine formula for distance calculation
- Bounding box pre-filter then exact distance sort
- Configurable radius (default from `BACKEND_DEFAULT_RADIUS_METERS` env)

### Vector Similarity

`ActivitiesService.findSimilar()` uses ChromaDB to find semantically similar activities based on embeddings of name + description + metadata.

### Metadata Generation

`ActivityMetadataService` uses LangChain to analyze activities and generate structured metadata: time-of-day preference, physical intensity, target audience, tags, complementary activities, etc.

## API Endpoints

| Method   | Path                        | Description                            |
| -------- | --------------------------- | -------------------------------------- |
| `POST`   | `/activities`               | Create an activity                     |
| `GET`    | `/activities/all`           | List activities (with geo filters)     |
| `GET`    | `/activities/:id`           | Get activity by ID                     |
| `PATCH`  | `/activities/:id`           | Update an activity                     |
| `DELETE` | `/activities/:id`           | Delete an activity                     |
| `POST`   | `/activities/nearby`        | Find nearby activities                 |
| `GET`    | `/activities/:id/similar`   | Find similar via vector search         |
| `POST`   | `/activities/search-hybrid` | **Main search** — hybrid with crawling |

## Dependencies

- **`GooglePlacesService`** — Background crawling (from `modules/integrations`)
- **`VectorStoreService`** — ChromaDB similarity (from `shared/ai`)
- **`LangChainService`** — AI metadata generation (from `shared/ai`)
- **`PrismaService`** — Database (from `core/database`)

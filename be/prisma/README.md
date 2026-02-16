# Prisma Schema & Migrations

Database schema for PostgreSQL, managed by [Prisma ORM](https://www.prisma.io/).

## Architecture

```
prisma/
├── schema.prisma          # Database schema definition
├── seed.ts                # Database seeding script
└── migrations/
    ├── 20251125000830_baseline/
    │   └── migration.sql
    └── 20251125001608_add_categories_to_tour/
        └── migration.sql
```

## Data Models

### `Activity` (table: `activity`)

Core entity — represents a place, attraction, restaurant, etc.

| Field                | Type        | Description                                  |
| -------------------- | ----------- | -------------------------------------------- |
| `id`                 | UUID        | Primary key                                  |
| `name`               | String      | Activity name                                |
| `description`        | String?     | Text description                             |
| `type`               | String?     | Activity type                                |
| `latitude/longitude` | Float?      | Geolocation                                  |
| `rating/ratingCount` | Float?/Int? | Google Places rating                         |
| `photos`             | JSON?       | Photo URLs                                   |
| `metadata`           | JSON?       | AI-generated metadata (tags, audience, etc.) |
| `sourceId`           | FK → Source | Data origin                                  |
| `externalId`         | String?     | External ID (e.g., Google Place ID)          |

**Indexes**: `(latitude, longitude)`, `(sourceId)`, unique `(sourceId, externalId)`

### `Tour` (table: `tour`)

An AI-generated itinerary with linked activities.

| Field        | Type     | Description                               |
| ------------ | -------- | ----------------------------------------- |
| `id`         | UUID     | Primary key                               |
| `name`       | String   | Tour name                                 |
| `prompt`     | String?  | Original generation prompt                |
| `categories` | String[] | Category tags (walking, food, history...) |
| `totalDays`  | Int?     | Duration in days                          |
| `coverImage` | String?  | Generated cover image URL                 |
| `metadata`   | JSON?    | Additional AI data                        |

### `TourActivity` (table: `tour_activity`)

Join table linking tours to activities with ordering and context:

- `order`, `dayNumber` — Position in the tour
- `travelTimeToNext`, `distanceToNext` — Travel logistics
- `notes` — AI-generated activity-specific notes
- `activityName/Type/Latitude/Longitude` — Inline data for activities not yet in DB

### `CrawlerSearch` (table: `crawler_search`)

Tracks which areas have been crawled to prevent redundant Google Places API calls. Unique by `(latitude, longitude)`.

### `Source` (table: `source`)

Data source tracking — `"external"` (Google Places), `"ai"` (generated), or `"manual"`.

### `ActivityRelationship` (table: `activity_relationship`)

Compatibility scoring between activity pairs: `compatibilityScore`, `timeCompatibilityScore`, `distanceScore`, `varietyScore`.

### `KnownActivityType` (table: `known_activity_types`)

Canonical activity categories used for classification.

## Common Commands

```bash
# Generate Prisma Client after schema changes
yarn prisma generate

# Create a new migration
yarn prisma migrate dev --name <migration_name>

# Apply migrations in production
yarn prisma migrate deploy

# Open Prisma Studio (DB GUI)
yarn prisma studio

# Seed the database
yarn prisma db seed
```

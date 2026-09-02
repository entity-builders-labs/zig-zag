# Tours Module

The most complex module in the backend — handles AI-powered tour generation, CRUD operations, and location-based tour discovery.

## Architecture

```
tours/
├── controllers/
│   └── tours.controller.ts          # REST API endpoints
├── dto/
│   ├── create-tour.dto.ts           # Manual tour creation
│   ├── create-tour-from-wizard.dto.ts # Canonical wizard intent + mobility
│   └── update-tour.dto.ts
├── interfaces/
│   └── tour-generation.interface.ts # Canonical request and legacy internal options
├── prompts/                         # LangChain prompt templates
│   ├── contextual-activities.prompt.ts
│   ├── create-tour.prompt.ts
│   ├── media-generation.prompt.ts
│   └── index.ts
├── services/
│   ├── tours.service.ts             # CRUD operations
│   ├── tour-generation.service.ts   # AI tour generation pipeline
│   ├── tour-activity-generation.service.ts # Background activity generation
│   ├── tour-image.service.ts        # Cover image generation (DALL-E)
│   └── tour-location.service.ts     # Nearby tour discovery
├── utils/
│   ├── activity-transformer.util.ts # Activity data transformation
│   ├── json-parser.util.ts          # Safe JSON parsing from AI responses
│   ├── prompt-builder.util.ts       # Dynamic prompt construction
│   └── travel-time-calculator.util.ts
└── tours.module.ts
```

## Key Flows

### Tour Generation (Wizard → AI)

The primary flow when a user creates a tour from the mobile app wizard:

1. **`POST /tours/generate-tour`** → `ToursController.generateTour()`
2. **`TourGenerationService.createTourFromWizard()`**:
   - Validates and normalizes one canonical `TourGenerationRequest`
   - Creates a basic tour record and persists that request in PostgreSQL
   - Builds selector input from typed intent and mobility preferences
   - Kicks off **background** activity generation (non-blocking)
3. **The async tour-generation processor** (background):
   - Reads only the persisted canonical generation request
   - Interprets free-text preferences through the configured LLM
   - Discovers candidate Experiences with grounded search
   - Resolves component hints against Places/OSM and validates geographic coherence
   - Runs deterministic daily planning and persists `TourExperience` snapshots
   - Publishes media work through the existing outbox flow

The request distinguishes thematic interests, exploration style,
allowed transportation modes, daily/continuous walking
limits, pace, accessibility, and bounded additional preferences. PR 4 captures
and traces every dimension; deterministic walking and transport enforcement is
deliberately deferred to the spatial-feasibility stage.

### Nearby Tours Discovery

- **`GET /tours/nearby?lat=X&lng=Y&category=Z`**
- `TourLocationService.getNearbyTours()` finds existing tours near coordinates
- If insufficient results, can trigger new tour generation

### LangChain Prompts

The `prompts/` folder contains structured prompt templates that:

- Define the AI's role and expected JSON output format
- Include existing activity context for better recommendations
- Handle different tour types (contextual, nearby, from-scratch)

## API Endpoints

| Method   | Path                             | Description                            |
| -------- | -------------------------------- | -------------------------------------- |
| `POST`   | `/tours`                         | Create a tour manually                 |
| `POST`   | `/tours/generate-tour`           | Generate tour from wizard preferences  |
| `GET`    | `/tours/nearby`                  | Find tours near a location             |
| `GET`    | `/tours`                         | List all tours (paginated, filterable) |
| `GET`    | `/tours/:id`                     | Get tour by ID                         |
| `PATCH`  | `/tours/:id`                     | Update a tour                          |
| `DELETE` | `/tours/:id`                     | Delete a tour                          |

## Dependencies

- **`LangChainService`** — AI model interaction (from `shared/ai`)
- **`VectorStoreService`** — pgvector similarity search (from `shared/ai`)
- **`ExperienceCatalogService`** — Verified Experience and component snapshots
- **`ImageGenerationService`** — DALL-E cover images (from `shared/ai`)
- **`PrismaService`** — Database access (from `core/database`)

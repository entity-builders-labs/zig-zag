# Tours Module

The most complex module in the backend — handles AI-powered tour generation, CRUD operations, and location-based tour discovery.

## Architecture

```
tours/
├── controllers/
│   └── tours.controller.ts          # REST API endpoints
├── dto/
│   ├── create-tour.dto.ts           # Manual tour creation
│   ├── create-tour-from-prompt.dto.ts # Wizard-based generation
│   └── update-tour.dto.ts
├── interfaces/
│   └── tour-generation.interface.ts # GenerateTourOptions type
├── prompts/                         # LangChain prompt templates
│   ├── activity-recommendation.prompt.ts
│   ├── contextual-activities.prompt.ts
│   ├── create-tour.prompt.ts
│   ├── media-generation.prompt.ts
│   ├── nearby-tour.prompt.ts
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
   - Creates a basic tour record in PostgreSQL
   - Builds an AI prompt from wizard preferences (destination, days, interests, budget, etc.)
   - Kicks off **background** activity generation (non-blocking)
3. **`TourActivityGenerationService.generateTourActivities()`** (background):
   - Uses `LangChainService` to generate activity recommendations
   - Searches for existing nearby activities in the DB
   - Enriches with vector similarity search (pgvector)
   - Creates `TourActivity` records linking activities to the tour
   - Optionally generates a cover image via `TourImageService`

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
| `POST`   | `/tours/:id/generate-activities` | Generate activities for existing tour  |
| `GET`    | `/tours/nearby`                  | Find tours near a location             |
| `GET`    | `/tours`                         | List all tours (paginated, filterable) |
| `GET`    | `/tours/:id`                     | Get tour by ID                         |
| `PATCH`  | `/tours/:id`                     | Update a tour                          |
| `DELETE` | `/tours/:id`                     | Delete a tour                          |

## Dependencies

- **`LangChainService`** — AI model interaction (from `shared/ai`)
- **`VectorStoreService`** — pgvector similarity search (from `shared/ai`)
- **`ActivitiesService`** — Access to existing activities (from `modules/activities`)
- **`ImageGenerationService`** — DALL-E cover images (from `shared/ai`)
- **`PrismaService`** — Database access (from `core/database`)

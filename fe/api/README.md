# API Layer

Centralized API communication layer. All backend calls go through this module.

## Architecture

```
api/
├── config/
│   ├── axios.ts           # Axios instance configuration
│   └── constants.ts       # Default location, API URL, radius
├── hooks/
│   └── useApi.ts          # Generic data fetching hook
├── services/
│   └── api.service.ts     # Base API service class
├── activities.ts          # Activity API functions
└── tours.ts               # Tour API functions + types
```

## Configuration (`config/`)

### `axios.ts`

Pre-configured Axios instance with:

- Base URL from `EXPO_PUBLIC_API_URL` env var
- Default timeout
- Base headers

### `constants.ts`

App-wide constants:

- `DEFAULT_LOCATION` — Buenos Aires coordinates (default map center)
- `DEFAULT_RADIUS_METERS` — From `EXPO_PUBLIC_DEFAULT_RADIUS_METERS` env var (default: 3000)

## API Functions

### Tours (`tours.ts`)

| Function                                       | Method | Endpoint               | Description                 |
| ---------------------------------------------- | ------ | ---------------------- | --------------------------- |
| `fetchNearbyTours(lat, lng, category, radius)` | GET    | `/tours/nearby`        | Find tours near coordinates |
| `fetchTourById(id)`                            | GET    | `/tours/:id`           | Get tour detail             |
| `generateTour(data)`                           | POST   | `/tours/generate-tour` | Generate tour from wizard   |

Exports TypeScript interfaces: `Tour`, `GenerateTourDto`

### Activities (`activities.ts`)

Activity API functions (basic wrapper around axios).

## Hooks (`hooks/`)

### `useApi`

Generic hook for data fetching:

```typescript
const { data, error, loading } = useApi(fetchFunction, autoFetch, dependencies);
```

- `autoFetch` — Whether to call on mount
- `dependencies` — React dependency array for re-fetching

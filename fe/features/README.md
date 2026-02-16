# Features Directory

Feature-based modules that encapsulate business logic, data fetching, and domain-specific components. Each feature folder groups its UI, hooks, and types together.

## Architecture

```
features/
├── activities/
│   ├── index.tsx              # Activities list component (renders on home)
│   ├── types.ts               # Activity type definitions
│   └── use-activities.tsx     # Hook for fetching/managing activities
├── map/
│   ├── index.tsx              # Map component (native, uses react-native-maps)
│   ├── index.web.tsx          # Web fallback map implementation
│   └── types.ts               # Map-related type definitions
├── tours/
│   ├── tours.tsx              # Tour list component
│   ├── use-tours.tsx          # Hook for fetching nearby tours
│   └── use-create-tour.ts    # Hook for tour wizard generation flow
└── search-by-address-input.tsx  # Address search with autocomplete
```

## Feature Details

### Activities (`activities/`)

- **`index.tsx`** — Main activities list rendered on the Home screen. Displays activities as cards with photos, ratings, distance, and type.
- **`use-activities.tsx`** — Custom hook wrapping `AppContext.getActivities()`. Handles loading state, error handling, and re-fetching.

### Map (`map/`)

- **`index.tsx`** — Native map component using `react-native-maps` (MapView). Shows activity markers, user location, and supports panning/zooming.
- **`index.web.tsx`** — Web-specific fallback implementation for map rendering.
- Platform-specific rendering handled automatically by React Native's file extension resolution.

### Tours (`tours/`)

- **`use-tours.tsx`** — Fetches nearby tours via `fetchNearbyTours()` API call. Uses the user's current map center coordinates.
- **`use-create-tour.ts`** — Manages the full tour creation wizard flow:
  1. Collects preferences (destination, days, interests, budget, pace, etc.)
  2. Calls `generateTour()` API
  3. Handles loading/error states
  4. Navigates to the created tour's detail page
